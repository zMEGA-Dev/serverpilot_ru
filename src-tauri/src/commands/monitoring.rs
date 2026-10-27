use crate::ssh;
use crate::monitoring::{self, ServerStats};
use tauri::State;
use crate::AppState;

#[tauri::command]
pub fn get_server_stats(
    _state: State<AppState>,
    server_id: String,
) -> Result<ServerStats, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения к серверу".to_string());
    }

    let result = ssh::execute_command(&server_id, monitoring::STATS_COMMAND)
        .map_err(|e| e.to_string())?;

    // Используем stdout, при ошибке — stderr
    let output = if !result.stdout.trim().is_empty() {
        result.stdout.clone()
    } else {
        result.stderr.clone()
    };

    if output.trim().is_empty() {
        return Err("Сервер не вернул данные метрик".to_string());
    }

    monitoring::parse_stats(&server_id, &output)
        .map_err(|e| format!("Ошибка парсинга метрик: {} | Вывод: {}", e, output.chars().take(200).collect::<String>()))
}

/// Выполнить простую команду и вернуть stdout.
#[tauri::command]
pub fn run_command(
    _state: State<AppState>,
    server_id: String,
    command: String,
) -> Result<String, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }
    let result = ssh::execute_command(&server_id, &command)
        .map_err(|e| e.to_string())?;
    Ok(result.stdout)
}
