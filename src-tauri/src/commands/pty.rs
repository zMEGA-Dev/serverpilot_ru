use crate::pty::{self, PtyOpenParams};
use crate::AppState;
use crate::crypto;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::params;
use tauri::State;

// ─── Вспомогательная функция: получить credentials ──

fn get_credential(state: &AppState, server_id: &str, cred_type: &str) -> Option<String> {
    let db = state.db.lock().ok()?;
    let encrypted: String = db.conn.query_row(
        "SELECT encrypted_value FROM server_credentials WHERE server_id = ?1 AND credential_type = ?2",
        params![server_id, cred_type],
        |row| row.get(0),
    ).ok()?;
    crypto::decrypt(&encrypted).ok()
}

fn build_pty_params(
    state: &AppState,
    server_id: &str,
    rows: u32,
    cols: u32,
) -> Result<PtyOpenParams, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let (host, port, username, auth_type, key_path): (String, u16, String, String, Option<String>) = db
        .conn
        .query_row(
            "SELECT host, port, username, auth_type, key_path FROM servers WHERE id = ?1",
            params![server_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|e| format!("Сервер не найден: {}", e))?;
    drop(db);

    let password = get_credential(state, server_id, "password");
    let key_passphrase = get_credential(state, server_id, "passphrase");

    Ok(PtyOpenParams {
        server_id: server_id.to_string(),
        host, port, username, auth_type,
        password, key_path, key_passphrase,
        rows, cols,
    })
}

// ─── Tauri команды ───────────────────────────────────

/// Открыть новую PTY-сессию. Создаёт отдельное SSH соединение.
#[tauri::command]
pub fn pty_open(
    state: State<AppState>,
    server_id: String,
    rows: u32,
    cols: u32,
) -> Result<String, String> {
    log::info!("[PTY CMD] pty_open server={} {}x{}", server_id, cols, rows);
    let params = build_pty_params(&state, &server_id, rows, cols)?;
    pty::open(&params).map_err(|e| {
        log::error!("[PTY CMD] pty_open failed: {}", e);
        e.to_string()
    })
}

/// Записать данные в PTY (ввод пользователя).
/// data — base64-encoded байты (поддерживает бинарные escape sequences)
#[tauri::command]
pub fn pty_write(
    _state: State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = BASE64.decode(&data)
        .map_err(|e| format!("Ошибка декодирования: {}", e))?;

    pty::write(&session_id, &bytes).map_err(|e| e.to_string())
}

/// Прочитать доступные данные из PTY.
/// Возвращает base64-encoded данные. Неблокирующий — если данных нет, возвращает пустую строку.
#[tauri::command]
pub fn pty_read(
    _state: State<AppState>,
    session_id: String,
) -> Result<crate::pty::PtyReadResult, String> {
    let (data, alive) = pty::read(&session_id).map_err(|e| e.to_string())?;

    Ok(crate::pty::PtyReadResult {
        data: BASE64.encode(&data),
        alive,
    })
}

/// Изменить размер PTY при resize окна терминала.
#[tauri::command]
pub fn pty_resize(
    _state: State<AppState>,
    session_id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    log::debug!("[PTY CMD] resize {} → {}x{}", session_id, cols, rows);
    pty::resize(&session_id, rows, cols).map_err(|e| e.to_string())
}

/// Закрыть PTY-сессию и освободить ресурсы.
#[tauri::command]
pub fn pty_close(
    _state: State<AppState>,
    session_id: String,
) -> Result<(), String> {
    log::info!("[PTY CMD] pty_close {}", session_id);
    pty::close(&session_id);
    Ok(())
}

/// Проверить жива ли PTY-сессия.
#[tauri::command]
pub fn pty_alive(
    _state: State<AppState>,
    session_id: String,
) -> bool {
    pty::is_alive(&session_id)
}
