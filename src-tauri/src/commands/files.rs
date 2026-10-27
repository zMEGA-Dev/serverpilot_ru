use crate::files::{self, FileEntry, FileContent};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tauri::State;
use crate::AppState;

#[tauri::command]
pub fn sftp_list_dir(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    log::info!("[SFTP] list_dir server={} path={}", server_id, path);
    let t = std::time::Instant::now();
    let r = files::list_dir(&server_id, &path).map_err(|e| {
        log::error!("[SFTP] list_dir FAILED in {}ms: {}", t.elapsed().as_millis(), e);
        e.to_string()
    })?;
    log::info!("[SFTP] list_dir OK in {}ms, {} entries", t.elapsed().as_millis(), r.len());
    Ok(r)
}

#[tauri::command]
pub fn sftp_stat(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<FileEntry, String> {
    log::info!("[SFTP] stat server={} path={}", server_id, path);
    files::stat(&server_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_read_file(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<FileContent, String> {
    log::info!("[SFTP] read_file server={} path={}", server_id, path);
    let t = std::time::Instant::now();
    let r = files::read_text_file(&server_id, &path).map_err(|e| {
        log::error!("[SFTP] read_file FAILED in {}ms: {}", t.elapsed().as_millis(), e);
        e.to_string()
    })?;
    log::info!("[SFTP] read_file OK in {}ms size={}", t.elapsed().as_millis(), r.size);
    Ok(r)
}

#[tauri::command]
pub fn sftp_write_file(
    _state: State<AppState>,
    server_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    log::info!("[SFTP] write_file server={} path={}", server_id, path);
    files::write_text_file(&server_id, &path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_create_dir(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<(), String> {
    log::info!("[SFTP] create_dir server={} path={}", server_id, path);
    files::create_dir(&server_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_create_file(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<(), String> {
    log::info!("[SFTP] create_file server={} path={}", server_id, path);
    files::create_file(&server_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_rename(
    _state: State<AppState>,
    server_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    log::info!("[SFTP] rename {} -> {}", old_path, new_path);
    files::rename(&server_id, &old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_delete_file(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<(), String> {
    log::info!("[SFTP] delete_file server={} path={}", server_id, path);
    files::delete_file(&server_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_delete_dir(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<(), String> {
    log::info!("[SFTP] delete_dir server={} path={}", server_id, path);
    files::delete_dir(&server_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_download_file(
    _state: State<AppState>,
    server_id: String,
    path: String,
) -> Result<String, String> {
    log::info!("[SFTP] download_file server={} path={}", server_id, path);
    let t = std::time::Instant::now();
    let bytes = files::download_file(&server_id, &path).map_err(|e| {
        log::error!("[SFTP] download FAILED in {}ms: {}", t.elapsed().as_millis(), e);
        e.to_string()
    })?;
    log::info!("[SFTP] download OK in {}ms, {} bytes", t.elapsed().as_millis(), bytes.len());
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn sftp_upload_file(
    _state: State<AppState>,
    server_id: String,
    path: String,
    data_b64: String,
) -> Result<(), String> {
    log::info!("[SFTP] upload_file server={} path={}", server_id, path);
    let data = BASE64
        .decode(&data_b64)
        .map_err(|e| format!("Ошибка декодирования данных: {}", e))?;
    files::upload_file(&server_id, &path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_chmod(
    _state: State<AppState>,
    server_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    log::info!("[SFTP] chmod server={} path={} mode={:o}", server_id, path, mode);
    files::chmod(&server_id, &path, mode).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sftp_sanitize_path(path: String) -> Result<String, String> {
    files::sanitize_path(&path).map_err(|e| e.to_string())
}
