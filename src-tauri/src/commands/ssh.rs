use crate::AppState;
use crate::crypto;
use crate::ssh::{self, SshConnectionParams, SshConnectionResult, CommandResult};
use rusqlite::params;
use tauri::State;
use chrono::Utc;
use uuid::Uuid;

fn get_credential(state: &AppState, server_id: &str, cred_type: &str) -> Option<String> {
    let db = state.db.lock().ok()?;
    let encrypted: String = db.conn.query_row(
        "SELECT encrypted_value FROM server_credentials WHERE server_id = ?1 AND credential_type = ?2",
        params![server_id, cred_type],
        |row| row.get(0),
    ).ok()?;
    crypto::decrypt(&encrypted).ok()
}

fn build_params(state: &AppState, server_id: &str) -> Result<SshConnectionParams, String> {
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
    Ok(SshConnectionParams {
        server_id: server_id.to_string(),
        host, port, username, auth_type, password, key_path, key_passphrase,
    })
}

#[tauri::command]
pub fn test_ssh_connection(
    _state: State<AppState>,
    request: SshConnectionParams,
) -> SshConnectionResult {
    log::info!("[SSH] test_connection → {}:{}", request.host, request.port);
    let result = ssh::test_connection(&request);
    log::info!("[SSH] test_connection result: success={}", result.success);
    result
}

#[tauri::command]
pub fn connect_ssh(
    state: State<AppState>,
    server_id: String,
) -> Result<SshConnectionResult, String> {
    log::info!("[SSH] connect_ssh → server_id={}", server_id);
    let params = build_params(&state, &server_id)?;
    log::info!("[SSH] params built → {}:{}", params.host, params.port);
    let result = ssh::connect(&params).map_err(|e| {
        log::error!("[SSH] connect failed: {}", e);
        e.to_string()
    })?;
    log::info!("[SSH] connect success, fingerprint={:?}", result.fingerprint);
    Ok(result)
}

#[tauri::command]
pub fn disconnect_ssh(server_id: String) -> Result<(), String> {
    log::info!("[SSH] disconnect → {}", server_id);
    ssh::disconnect(&server_id);
    Ok(())
}

#[tauri::command]
pub fn execute_command(
    state: State<AppState>,
    server_id: String,
    command: String,
) -> Result<CommandResult, String> {
    log::info!("[SSH] execute_command → server={} cmd={:?}", server_id, &command[..command.len().min(80)]);
    let t = std::time::Instant::now();

    log_command(&state, &server_id, &command);

    let result = ssh::execute_command(&server_id, &command).map_err(|e| {
        log::error!("[SSH] execute_command failed in {}ms: {}", t.elapsed().as_millis(), e);
        e.to_string()
    })?;

    log::info!("[SSH] execute_command done in {}ms, exit_code={}", t.elapsed().as_millis(), result.exit_code);
    save_history(&state, &server_id, &command, &result);
    Ok(result)
}

fn log_command(state: &AppState, server_id: &str, command: &str) {
    if let Ok(db) = state.db.lock() {
        let _ = db.conn.execute(
            "INSERT INTO audit_log (id, server_id, action, command, timestamp) VALUES (?1, ?2, 'execute_command', ?3, ?4)",
            params![Uuid::new_v4().to_string(), server_id, command, Utc::now().to_rfc3339()],
        );
    }
}

fn save_history(state: &AppState, server_id: &str, command: &str, result: &CommandResult) {
    // Усекаем stdout до 4 КБ — предотвращаем хранение потенциально секретного вывода
    // Полный вывод пользователь видит в UI, но не сохраняется в БД
    const MAX_OUTPUT_LEN: usize = 4096;
    let output = if result.stdout.len() > MAX_OUTPUT_LEN {
        format!("{}...[усечено]", &result.stdout[..MAX_OUTPUT_LEN])
    } else {
        result.stdout.clone()
    };

    if let Ok(db) = state.db.lock() {
        let _ = db.conn.execute(
            "INSERT INTO command_history (id, server_id, command, output, exit_code, executed_at, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(), server_id, command,
                &output, result.exit_code,
                Utc::now().to_rfc3339(), result.duration_ms as i64,
            ],
        );
    }
}
