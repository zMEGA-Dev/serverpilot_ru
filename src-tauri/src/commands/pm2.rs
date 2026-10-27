use crate::pm2::{self, Pm2App, Pm2ActionResult};
use crate::ssh;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

// ─── Определение PM2 ────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Pm2DetectResult {
    pub installed: bool,
    pub version: String,
    pub error: String,
}

#[tauri::command]
pub fn pm2_detect(
    _state: State<AppState>,
    server_id: String,
) -> Result<Pm2DetectResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let result = ssh::execute_command(&server_id, pm2::DETECT_COMMAND)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();

    if output == "NOT_FOUND" || output.is_empty() || result.exit_code != 0 {
        return Ok(Pm2DetectResult {
            installed: false,
            version: String::new(),
            error: String::new(),
        });
    }

    // Версия — первая строка без лишних символов
    let version = output.lines().next().unwrap_or("").trim().to_string();

    // Убеждаемся что это похоже на версию (X.Y.Z)
    let looks_like_version = version.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);

    Ok(Pm2DetectResult {
        installed: looks_like_version,
        version: if looks_like_version { version } else { String::new() },
        error: if !looks_like_version { output } else { String::new() },
    })
}

// ─── Список приложений ──────────────────────────────

#[tauri::command]
pub fn pm2_list(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<Pm2App>, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let result = ssh::execute_command(&server_id, pm2::LIST_COMMAND)
        .map_err(|e| e.to_string())?;

    let output = if !result.stdout.trim().is_empty() {
        &result.stdout
    } else {
        &result.stderr
    };

    Ok(pm2::parse_jlist(output))
}

// ─── Детали приложения с env ────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Pm2AppDetail {
    pub app: Pm2App,
    pub env: Vec<(String, String)>,
}

#[tauri::command]
pub fn pm2_detail(
    _state: State<AppState>,
    server_id: String,
    app_name: String,
) -> Result<Pm2AppDetail, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let result = ssh::execute_command(&server_id, pm2::LIST_COMMAND)
        .map_err(|e| e.to_string())?;

    let output = if !result.stdout.trim().is_empty() {
        &result.stdout
    } else {
        &result.stderr
    };

    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Err(format!("Приложение «{}» не найдено в PM2", app_name));
    }

    let arr: Vec<Value> = serde_json::from_str(trimmed)
        .map_err(|_| "Не удалось разобрать ответ PM2".to_string())?;

    let item = arr.iter()
        .find(|v| v["name"].as_str().map_or(false, |n| n == app_name))
        .ok_or_else(|| format!("Приложение «{}» не найдено", app_name))?;

    let app = pm2::parse_jlist(&serde_json::to_string(&vec![item]).unwrap_or_default())
        .into_iter().next()
        .ok_or_else(|| "Не удалось разобрать данные приложения".to_string())?;

    let env = pm2::parse_env(item);

    Ok(Pm2AppDetail { app, env })
}

// ─── Действия над приложением ───────────────────────

#[tauri::command]
pub fn pm2_action(
    _state: State<AppState>,
    server_id: String,
    action: String,
    app_name: String,
) -> Result<Pm2ActionResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let allowed = ["restart", "reload", "stop", "start", "delete"];
    if !allowed.contains(&action.as_str()) {
        return Err(format!("Недопустимое действие: {}", action));
    }

    let cmd = pm2::action_command(&action, &app_name)
        .map_err(|e| e.to_string())?;

    let result = ssh::execute_command(&server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let success = result.exit_code == 0;
    let raw_output = format!("{}{}", result.stdout, result.stderr).trim().to_string();

    let message = if success {
        let action_label = match action.as_str() {
            "restart" => "перезапущено",
            "reload"  => "перезагружено",
            "stop"    => "остановлено",
            "start"   => "запущено",
            "delete"  => "удалено из PM2",
            _ => "выполнено",
        };
        format!("Приложение «{}» {}", app_name, action_label)
    } else {
        let err = raw_output.lines().take(3).collect::<Vec<_>>().join(" ");
        format!("Не удалось выполнить действие «{}» для «{}». PM2: {}", action, app_name, err)
    };

    Ok(Pm2ActionResult { success, message, raw_output })
}

// ─── Логи приложения ────────────────────────────────

#[tauri::command]
pub fn pm2_logs(
    _state: State<AppState>,
    server_id: String,
    app_name: String,
    lines: u32,
) -> Result<String, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    // lines ограничиваем до разумного максимума
    let safe_lines = lines.min(1000).max(10);
    let cmd = pm2::logs_command(&app_name, safe_lines);

    let result = ssh::execute_command(&server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();
    if output.is_empty() {
        Ok("Логи пусты".to_string())
    } else {
        Ok(output)
    }
}

// ─── Запустить новое приложение ─────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Pm2StartRequest {
    pub name: String,
    pub script: String,
    pub cwd: String,
    pub interpreter: String,
    pub args: String,
}

#[tauri::command]
pub fn pm2_start_new(
    _state: State<AppState>,
    server_id: String,
    request: Pm2StartRequest,
) -> Result<Pm2ActionResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    // Базовая валидация
    if request.name.trim().is_empty() {
        return Err("Название приложения не может быть пустым".to_string());
    }
    if request.script.trim().is_empty() {
        return Err("Путь к скрипту не может быть пустым".to_string());
    }

    let cmd = pm2::start_new_command(
        &request.name,
        &request.script,
        &request.cwd,
        &request.interpreter,
        &request.args,
    ).map_err(|e| e.to_string())?;

    let result = ssh::execute_command(&server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let success = result.exit_code == 0;
    let raw_output = format!("{}{}", result.stdout, result.stderr).trim().to_string();

    let message = if success {
        format!("Приложение «{}» запущено через PM2", request.name)
    } else {
        let err = raw_output.lines().take(3).collect::<Vec<_>>().join(" ");
        format!("Не удалось запустить «{}». PM2: {}", request.name, err)
    };

    Ok(Pm2ActionResult { success, message, raw_output })
}
