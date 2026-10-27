use crate::git;
use crate::ssh;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

// ─── Типы ────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct GitDetectResult {
    pub installed: bool,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub branch: String,
    pub commit_hash: String,
    pub commit_message: String,
    pub commit_author: String,
    pub commit_date: String,
    pub has_changes: bool,
    pub changes_summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitOperationResult {
    pub success: bool,
    pub output: String,
    pub exit_code: i32,
    pub message: String,
}

// ─── Проверка Git ─────────────────────────────────────

#[tauri::command]
pub fn git_detect(
    _state: State<AppState>,
    server_id: String,
) -> Result<GitDetectResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let result = ssh::execute_command(&server_id, git::GIT_VERSION_CMD)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();

    if output.contains("GIT_NOT_FOUND") || result.exit_code != 0 {
        return Ok(GitDetectResult { installed: false, version: String::new() });
    }

    // "git version 2.34.1"
    let version = output
        .lines()
        .next()
        .unwrap_or("")
        .replace("git version ", "")
        .trim()
        .to_string();

    Ok(GitDetectResult { installed: true, version })
}

// ─── Статус репозитория ───────────────────────────────

#[tauri::command]
pub fn git_repo_status(
    _state: State<AppState>,
    server_id: String,
    directory: String,
) -> Result<GitStatusResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    // Проверяем — git repo ли это
    let check_cmd = git::git_is_repo_cmd(&directory).map_err(|e| e.to_string())?;
    let check = ssh::execute_command(&server_id, &check_cmd).map_err(|e| e.to_string())?;

    if check.stdout.contains("NOT_GIT_REPO") || check.exit_code != 0 {
        return Ok(GitStatusResult {
            is_repo: false,
            branch: String::new(),
            commit_hash: String::new(),
            commit_message: String::new(),
            commit_author: String::new(),
            commit_date: String::new(),
            has_changes: false,
            changes_summary: String::new(),
        });
    }

    // Получаем инфо о репозитории
    let info_cmd = git::git_info_cmd(&directory).map_err(|e| e.to_string())?;
    let info_result = ssh::execute_command(&server_id, &info_cmd).map_err(|e| e.to_string())?;
    let info = git::parse_git_info(&info_result.stdout);

    // Проверяем незакоммиченные изменения
    let changes_cmd = git::git_has_changes_cmd(&directory).map_err(|e| e.to_string())?;
    let changes_result = ssh::execute_command(&server_id, &changes_cmd).map_err(|e| e.to_string())?;
    let changes_output = changes_result.stdout.trim().to_string();
    let has_changes = !changes_output.is_empty();

    Ok(GitStatusResult {
        is_repo: true,
        branch: info.branch,
        commit_hash: info.commit_hash,
        commit_message: info.commit_message,
        commit_author: info.commit_author,
        commit_date: info.commit_date,
        has_changes,
        changes_summary: changes_output,
    })
}

// ─── Clone ────────────────────────────────────────────

#[tauri::command]
pub fn git_clone(
    _state: State<AppState>,
    server_id: String,
    url: String,
    branch: String,
    directory: String,
) -> Result<GitOperationResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    log::info!("[GIT] clone → dir={} branch={}", directory, branch);

    let cmd = git::git_clone_cmd(&url, &branch, &directory)
        .map_err(|e| e.to_string())?;

    let result = ssh::execute_command(&server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let raw_output = format!("{}{}", result.stdout, result.stderr);
    let output = git::sanitize_git_output(&raw_output);
    let success = result.exit_code == 0;

    let message = if success {
        format!("Репозиторий успешно клонирован в {}", directory)
    } else {
        format_git_error(&output, "клонировании")
    };

    log::info!("[GIT] clone exit_code={}", result.exit_code);

    Ok(GitOperationResult { success, output, exit_code: result.exit_code, message })
}

// ─── Pull ─────────────────────────────────────────────

#[tauri::command]
pub fn git_pull(
    _state: State<AppState>,
    server_id: String,
    directory: String,
    branch: String,
) -> Result<GitOperationResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    log::info!("[GIT] pull → dir={} branch={}", directory, branch);

    let cmd = git::git_pull_cmd(&directory, &branch)
        .map_err(|e| e.to_string())?;

    let result = ssh::execute_command(&server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let raw_output = format!("{}{}", result.stdout, result.stderr);
    let output = git::sanitize_git_output(&raw_output);
    let success = result.exit_code == 0;

    let message = if success {
        if output.contains("Already up to date") || output.contains("Уже обновлено") {
            "Репозиторий уже актуален".to_string()
        } else {
            "Репозиторий успешно обновлён".to_string()
        }
    } else {
        format_git_error(&output, "обновлении")
    };

    log::info!("[GIT] pull exit_code={}", result.exit_code);

    Ok(GitOperationResult { success, output, exit_code: result.exit_code, message })
}

// ─── Вспомогательные ─────────────────────────────────

fn format_git_error(output: &str, action: &str) -> String {
    let lower = output.to_lowercase();

    if lower.contains("repository not found") || lower.contains("not found") {
        return format!("Репозиторий не найден. Проверьте URL.");
    }
    if lower.contains("authentication failed") || lower.contains("could not read username") {
        return format!("Ошибка аутентификации. Репозиторий приватный — нужен токен или SSH-ключ.");
    }
    if lower.contains("permission denied") {
        return format!("Нет прав доступа. Проверьте права на директорию или SSH-ключ.");
    }
    if lower.contains("already exists and is not an empty directory") {
        return format!("Директория уже существует и не пуста. Используйте «Обновить» вместо «Клонировать».");
    }
    if lower.contains("not a git repository") {
        return format!("Директория не является Git-репозиторием. Используйте «Клонировать».");
    }
    if lower.contains("invalid refspec") || lower.contains("branch") && lower.contains("not found") {
        return format!("Ветка не найдена. Проверьте название ветки.");
    }
    if lower.contains("could not resolve host") || lower.contains("network") {
        return format!("Ошибка сети. Не удалось подключиться к Git-серверу.");
    }
    if lower.contains("merge conflict") || lower.contains("conflict") {
        return format!("Конфликт слияния. Разрешите конфликты вручную.");
    }
    if lower.contains("your local changes") || lower.contains("error: cannot pull") {
        return format!("Обнаружены незакоммиченные изменения, которые мешают обновлению.");
    }

    format!("Ошибка при {}. Смотрите вывод выше.", action)
}
