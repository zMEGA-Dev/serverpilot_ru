use crate::AppState;
use crate::ssh;
use crate::files;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use chrono::Utc;
use uuid::Uuid;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

// ─── Типы ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backup {
    pub id: String,
    pub server_id: String,
    pub server_name: String,
    pub source_path: String,
    pub archive_name: String,
    pub archive_path: String,
    pub size_bytes: i64,
    pub status: String,
    pub error_message: String,
    pub created_at: String,
    pub downloaded_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupSpaceInfo {
    pub source_size_bytes: i64,
    pub free_bytes: i64,
    pub source_size_human: String,
    pub free_human: String,
    pub has_enough_space: bool,
    pub is_system_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupResult {
    pub success: bool,
    pub backup_id: String,
    pub archive_path: String,
    pub size_bytes: i64,
    pub size_human: String,
    pub message: String,
}

// ─── Системные директории (показываем предупреждение) ─

const SYSTEM_DIRS: &[&str] = &[
    "/etc", "/bin", "/sbin", "/lib", "/lib64", "/usr",
    "/boot", "/dev", "/proc", "/sys", "/run",
];

fn is_system_dir(path: &str) -> bool {
    let p = path.trim_end_matches('/');
    SYSTEM_DIRS.iter().any(|s| p == *s || p.starts_with(&format!("{}/", s)))
}

// ─── Валидация пути источника ─────────────────────────

fn validate_source_path(path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() { return Err("Путь источника не может быть пустым".to_string()); }
    if !p.starts_with('/') { return Err("Путь должен быть абсолютным".to_string()); }
    if p.contains("..") { return Err("Путь не может содержать '..'".to_string()); }
    // Запрещаем shell-спецсимволы
    let forbidden = [';', '&', '|', '`', '$', '(', ')', '<', '>', '\0', '\n', '\r', '\'', '"'];
    if p.chars().any(|c| forbidden.contains(&c)) {
        return Err("Путь содержит недопустимые символы".to_string());
    }
    if p.len() > 512 { return Err("Путь слишком длинный".to_string()); }
    Ok(p.to_string())
}

// ─── Вспомогательные функции ─────────────────────────

fn bytes_to_human(bytes: i64) -> String {
    if bytes < 1024 { return format!("{} Б", bytes); }
    if bytes < 1_048_576 { return format!("{:.1} КБ", bytes as f64 / 1024.0); }
    if bytes < 1_073_741_824 { return format!("{:.1} МБ", bytes as f64 / 1_048_576.0); }
    format!("{:.2} ГБ", bytes as f64 / 1_073_741_824.0)
}

fn format_backup_error(output: &str) -> String {
    let lower = output.to_lowercase();
    if lower.contains("no such file") || lower.contains("not found") {
        return "Источник не найден. Проверьте путь.".to_string();
    }
    if lower.contains("permission denied") {
        return "Нет прав доступа к источнику или временной директории.".to_string();
    }
    if lower.contains("no space left") {
        return "На сервере нет свободного места для создания архива.".to_string();
    }
    if lower.contains("cannot stat") || lower.contains("cannot open") {
        return "Не удалось открыть источник. Проверьте права доступа.".to_string();
    }
    let first = output.lines().next().unwrap_or("").trim();
    if first.is_empty() { "Неизвестная ошибка при создании архива.".to_string() }
    else { format!("Ошибка: {}", first) }
}

// ─── Проверка свободного места ────────────────────────

#[tauri::command]
pub fn backup_check_space(
    _state: State<AppState>,
    server_id: String,
    source_path: String,
) -> Result<BackupSpaceInfo, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let source = validate_source_path(&source_path).map_err(|e| e.to_string())?;

    // Размер источника
    let size_cmd = format!(
        "du -sb {:?} 2>/dev/null | awk '{{print $1}}' || echo 0",
        source
    );
    let size_result = ssh::execute_command(&server_id, &size_cmd)
        .map_err(|e| e.to_string())?;
    let source_size: i64 = size_result.stdout.trim().parse().unwrap_or(0);

    // Свободное место в /tmp (где будем создавать архив)
    let free_cmd = "df -B1 /tmp 2>/dev/null | tail -1 | awk '{print $4}' || echo 0";
    let free_result = ssh::execute_command(&server_id, free_cmd)
        .map_err(|e| e.to_string())?;
    let free_bytes: i64 = free_result.stdout.trim().parse().unwrap_or(0);

    Ok(BackupSpaceInfo {
        source_size_bytes: source_size,
        free_bytes,
        source_size_human: bytes_to_human(source_size),
        free_human: bytes_to_human(free_bytes),
        has_enough_space: free_bytes > source_size,
        is_system_dir: is_system_dir(&source),
    })
}

// ─── Создать backup ───────────────────────────────────

#[tauri::command]
pub fn backup_create(
    state: State<AppState>,
    server_id: String,
    server_name: String,
    source_path: String,
) -> Result<BackupResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let source = validate_source_path(&source_path).map_err(|e| e.to_string())?;

    log::info!("[BACKUP] create server={} source={}", server_id, source);

    // Генерируем имя архива: backup_имя_папки_TIMESTAMP.tar.gz
    let ts = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let base_name = std::path::Path::new(&source)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "root".to_string());
    // Убираем спецсимволы из имени
    let safe_name: String = base_name.chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();

    let archive_name = format!("backup_{}_{}.tar.gz", safe_name, ts);
    let archive_path = format!("/tmp/{}", archive_name);

    // Сохраняем запись в БД (статус: creating)
    let backup_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.conn.execute(
            "INSERT INTO backups (id, server_id, server_name, source_path, archive_name, archive_path, size_bytes, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'creating', ?7)",
            params![backup_id, server_id, server_name, source, archive_name, archive_path, now],
        ).map_err(|e| e.to_string())?;
    }

    // Создаём архив через tar.
    // Важно: source передаётся через {:?} (Rust Debug для строк) — это правильное кавычение.
    // archive_path также через {:?}. Это безопаснее чем прямая конкатенация.
    let tar_cmd = format!(
        "tar -czf {:?} -C {:?} . 2>&1 && echo TAR_OK || echo TAR_FAILED",
        archive_path,
        source
    );

    let result = ssh::execute_command(&server_id, &tar_cmd)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();
    let success = output.contains("TAR_OK") && result.exit_code == 0;

    if !success {
        // Обновляем статус на error
        let err_msg = format_backup_error(&output);
        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let _ = db.conn.execute(
                "UPDATE backups SET status='error', error_message=?1 WHERE id=?2",
                params![err_msg, backup_id],
            );
        }
        return Ok(BackupResult {
            success: false,
            backup_id,
            archive_path,
            size_bytes: 0,
            size_human: String::new(),
            message: err_msg,
        });
    }

    // Получаем размер созданного архива
    let size_cmd = format!("stat -c%s {:?} 2>/dev/null || echo 0", archive_path);
    let size_result = ssh::execute_command(&server_id, &size_cmd).unwrap_or_default_result();
    let size_bytes: i64 = size_result.stdout.trim().parse().unwrap_or(0);

    // Обновляем статус на ready
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db.conn.execute(
            "UPDATE backups SET status='ready', size_bytes=?1 WHERE id=?2",
            params![size_bytes, backup_id],
        );
    }

    log::info!("[BACKUP] created archive={} size={}", archive_path, size_bytes);

    Ok(BackupResult {
        success: true,
        backup_id,
        archive_path,
        size_bytes,
        size_human: bytes_to_human(size_bytes),
        message: format!("Резервная копия создана ({})", bytes_to_human(size_bytes)),
    })
}

// ─── Скачать backup ───────────────────────────────────

/// Скачивает архив через SFTP и возвращает base64-encoded содержимое.
/// Фронтенд сохраняет файл через Tauri dialog.
#[tauri::command]
pub fn backup_download(
    state: State<AppState>,
    server_id: String,
    backup_id: String,
) -> Result<(String, String), String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    // Получаем данные о backup из БД
    let (archive_path, archive_name) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.conn.query_row(
            "SELECT archive_path, archive_name FROM backups WHERE id=?1",
            params![backup_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ).map_err(|_| "Backup не найден".to_string())?
    };

    log::info!("[BACKUP] download backup_id={} path={}", backup_id, archive_path);

    // Скачиваем через SFTP
    let bytes = files::download_file(&server_id, &archive_path)
        .map_err(|e| format!("Ошибка скачивания: {}", e))?;

    // Обновляем статус
    let now = Utc::now().to_rfc3339();
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db.conn.execute(
            "UPDATE backups SET downloaded_at=?1 WHERE id=?2",
            params![now, backup_id],
        );
    }

    log::info!("[BACKUP] downloaded {} bytes", bytes.len());

    Ok((BASE64.encode(&bytes), archive_name))
}

// ─── Удалить архив с сервера ──────────────────────────

#[tauri::command]
pub fn backup_delete_remote(
    state: State<AppState>,
    server_id: String,
    backup_id: String,
) -> Result<(), String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    let archive_path = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.conn.query_row(
            "SELECT archive_path FROM backups WHERE id=?1",
            params![backup_id],
            |row| row.get::<_, String>(0),
        ).map_err(|_| "Backup не найден".to_string())?
    };

    // Только /tmp/ разрешено для удаления
    if !archive_path.starts_with("/tmp/") {
        return Err("Удаление разрешено только из /tmp/".to_string());
    }

    files::delete_file(&server_id, &archive_path)
        .map_err(|e| format!("Ошибка удаления: {}", e))?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let _ = db.conn.execute(
        "UPDATE backups SET status='deleted' WHERE id=?1",
        params![backup_id],
    );

    log::info!("[BACKUP] deleted remote {}", archive_path);
    Ok(())
}

// ─── Удалить запись из истории ────────────────────────

#[tauri::command]
pub fn backup_delete_record(
    state: State<AppState>,
    backup_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.conn.execute("DELETE FROM backups WHERE id=?1", params![backup_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Список backups ───────────────────────────────────

#[tauri::command]
pub fn backup_list(state: State<AppState>) -> Result<Vec<Backup>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.conn.prepare(
        "SELECT id, server_id, server_name, source_path, archive_name, archive_path,
                size_bytes, status, error_message, created_at, downloaded_at
         FROM backups ORDER BY created_at DESC LIMIT 100"
    ).map_err(|e| e.to_string())?;

    let list = stmt.query_map([], |row| {
        Ok(Backup {
            id:             row.get(0)?,
            server_id:      row.get(1)?,
            server_name:    row.get(2)?,
            source_path:    row.get(3)?,
            archive_name:   row.get(4)?,
            archive_path:   row.get(5)?,
            size_bytes:     row.get(6)?,
            status:         row.get(7)?,
            error_message:  row.get(8)?,
            created_at:     row.get(9)?,
            downloaded_at:  row.get(10)?,
        })
    }).map_err(|e| e.to_string())?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| e.to_string())?;

    Ok(list)
}

// ─── Вспомогательный трейт ────────────────────────────

trait DefaultResult {
    fn unwrap_or_default_result(self) -> crate::ssh::CommandResult;
}
impl DefaultResult for anyhow::Result<crate::ssh::CommandResult> {
    fn unwrap_or_default_result(self) -> crate::ssh::CommandResult {
        self.unwrap_or(crate::ssh::CommandResult {
            stdout: "0".to_string(),
            stderr: String::new(),
            exit_code: 0,
            duration_ms: 0,
        })
    }
}
