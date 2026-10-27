use crate::processes::{self, ProcessInfo};
use crate::ssh;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

// ─── Список процессов ────────────────────────────────

#[tauri::command]
pub fn get_processes(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения к серверу".to_string());
    }

    let result = ssh::execute_command(&server_id, processes::LIST_COMMAND)
        .map_err(|e| e.to_string())?;

    let output = if !result.stdout.trim().is_empty() {
        &result.stdout
    } else {
        &result.stderr
    };

    if output.trim().is_empty() {
        return Err("Сервер не вернул список процессов".to_string());
    }

    Ok(processes::parse_output(output))
}

// ─── Детали процесса ────────────────────────────────

#[tauri::command]
pub fn get_process_detail(
    _state: State<AppState>,
    server_id: String,
    pid: u32,
) -> Result<ProcessInfo, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения к серверу".to_string());
    }

    // PID 0 или 1 — защищённые
    if processes::is_protected_pid(pid) {
        return Err(format!("PID {} является системным и защищён", pid));
    }

    let cmd = processes::detail_command(pid);
    let result = ssh::execute_command(&server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();
    if output.is_empty() {
        return Err(format!("Процесс с PID {} не найден", pid));
    }

    processes::parse_line(&output)
        .ok_or_else(|| format!("Не удалось разобрать информацию о процессе PID {}", pid))
}

// ─── Завершение процесса ────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct KillResult {
    pub pid: u32,
    pub signal: String,
    pub success: bool,
    pub message: String,
}

/// Завершить процесс (SIGTERM — мягкое завершение).
#[tauri::command]
pub fn kill_process(
    _state: State<AppState>,
    server_id: String,
    pid: u32,
) -> Result<KillResult, String> {
    validate_and_kill(&server_id, pid, false)
}

/// Принудительно завершить процесс (SIGKILL — немедленное убийство).
#[tauri::command]
pub fn kill_process_force(
    _state: State<AppState>,
    server_id: String,
    pid: u32,
) -> Result<KillResult, String> {
    validate_and_kill(&server_id, pid, true)
}

fn validate_and_kill(server_id: &str, pid: u32, force: bool) -> Result<KillResult, String> {
    if !ssh::is_connected(server_id) {
        return Err("Нет активного SSH подключения к серверу".to_string());
    }

    // PID 0 и 1 — абсолютный запрет
    if processes::is_protected_pid(pid) {
        return Err(format!(
            "Завершение PID {} запрещено — это системный процесс",
            pid
        ));
    }

    // PID должен быть положительным числом (u32 уже это гарантирует)
    // Дополнительно убедимся что он не нулевой
    if pid == 0 {
        return Err("Некорректный PID: 0".to_string());
    }

    let signal = if force { "SIGKILL" } else { "SIGTERM" };

    // Сначала проверим что процесс существует
    let check_cmd = format!("kill -0 {} 2>&1 && echo EXISTS || echo NOTFOUND", pid);
    let check = ssh::execute_command(server_id, &check_cmd)
        .map_err(|e| e.to_string())?;

    if check.stdout.contains("NOTFOUND") || check.exit_code != 0 && check.stdout.contains("No such process") {
        return Err(format!("Процесс PID {} не существует или уже завершён", pid));
    }

    // Команда kill — PID передаётся как число, не как строка от пользователя
    let cmd = if force {
        processes::kill_kill_command(pid)
    } else {
        processes::kill_term_command(pid)
    };

    let result = ssh::execute_command(server_id, &cmd)
        .map_err(|e| e.to_string())?;

    let success = result.exit_code == 0;
    let message = if success {
        format!(
            "Процесс PID {} завершён ({})",
            pid, signal
        )
    } else {
        let err = result.stderr.trim();
        if err.is_empty() {
            format!("Не удалось завершить PID {}", pid)
        } else {
            format!("Ошибка: {}", err)
        }
    };

    Ok(KillResult {
        pid,
        signal: signal.to_string(),
        success,
        message,
    })
}
