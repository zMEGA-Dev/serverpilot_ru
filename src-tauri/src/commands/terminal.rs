use crate::terminal;
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct PtyReadResult {
    pub data: String,   // base64-encoded
    pub alive: bool,
}

/// Открыть PTY-сессию (shell).
#[tauri::command]
pub fn pty_start(
    _state: State<AppState>,
    server_id: String,
    rows: u32,
    cols: u32,
) -> Result<String, String> {
    terminal::start_pty(&server_id, rows, cols).map_err(|e| e.to_string())
}

/// Записать данные (ввод пользователя) в PTY.
#[tauri::command]
pub fn pty_write(
    _state: State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = BASE64.decode(&data).map_err(|e| format!("Ошибка: {}", e))?;
    terminal::write_pty(&session_id, &bytes).map_err(|e| e.to_string())
}

/// Прочитать данные из PTY.
#[tauri::command]
pub fn pty_read(
    _state: State<AppState>,
    session_id: String,
) -> Result<PtyReadResult, String> {
    let alive = terminal::is_pty_alive(&session_id);
    let data = terminal::read_pty(&session_id).unwrap_or_default();
    Ok(PtyReadResult {
        data: BASE64.encode(&data),
        alive,
    })
}

/// Изменить размер PTY.
#[tauri::command]
pub fn pty_resize(
    _state: State<AppState>,
    session_id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    terminal::resize_pty(&session_id, rows, cols).map_err(|e| e.to_string())
}

/// Закрыть PTY-сессию.
#[tauri::command]
pub fn pty_close(
    _state: State<AppState>,
    session_id: String,
) -> Result<(), String> {
    terminal::close_pty(&session_id);
    Ok(())
}

/// Проверить жива ли PTY сессия.
#[tauri::command]
pub fn pty_alive(
    _state: State<AppState>,
    session_id: String,
) -> bool {
    terminal::is_pty_alive(&session_id)
}
