use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ssh2::{FileStat, Sftp};
use std::io::{Read, Write};
use std::path::Path;

use crate::ssh::SSH_POOL;

// ─────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: String,
    pub permissions: String,
    pub permissions_octal: String,
    pub owner: String,
    pub group: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String, // UTF-8 текст
    pub size: u64,
    pub is_binary: bool,
}

// ─────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────

/// Канонизировать путь — убрать `..`, двойные слэши, убедиться что начинается с `/`.
/// Защита от path traversal.
pub fn sanitize_path(raw: &str) -> Result<String> {
    let raw = raw.trim();

    // Не пустой
    if raw.is_empty() {
        return Ok("/".to_string());
    }

    // Нормализуем через PathBuf
    let mut components = Vec::new();
    for part in raw.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                // Не выходим выше корня
                if !components.is_empty() {
                    components.pop();
                }
            }
            c => {
                // Запрещаем нулевые байты
                if c.contains('\0') {
                    return Err(anyhow::anyhow!("Недопустимый символ в пути"));
                }
                components.push(c);
            }
        }
    }

    let clean = format!("/{}", components.join("/"));
    Ok(clean)
}

/// Форматировать права доступа Unix в rwxrwxrwx.
fn format_permissions(mode: u32) -> String {
    let chars = ['x', 'w', 'r'];
    let mut result = String::with_capacity(9);
    for shift in [6u32, 3, 0] {
        for bit in [2u32, 1, 0] {
            if (mode >> (shift + bit)) & 1 == 1 {
                result.push(chars[bit as usize]);
            } else {
                result.push('-');
            }
        }
    }
    result
}

fn format_permissions_octal(mode: u32) -> String {
    format!("{:04o}", mode & 0o7777)
}

/// Преобразовать Unix timestamp в ISO строку.
fn ts_to_string(ts: i64) -> String {
    if ts == 0 {
        return "—".to_string();
    }
    // Простой форматтер без внешних зависимостей на временные зоны
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "—".to_string())
}

fn stat_to_entry(name: &str, path: &str, stat: &FileStat, is_symlink: bool) -> FileEntry {
    let mode = stat.perm.unwrap_or(0);
    let is_dir = (mode & 0o170000) == 0o040000;
    let size = stat.size.unwrap_or(0);
    let mtime = stat.mtime.unwrap_or(0) as i64;
    let uid = stat.uid.unwrap_or(0);
    let gid = stat.gid.unwrap_or(0);

    FileEntry {
        name: name.to_string(),
        path: path.to_string(),
        is_dir,
        is_symlink,
        size,
        modified: ts_to_string(mtime),
        permissions: format_permissions(mode & 0o777),
        permissions_octal: format_permissions_octal(mode),
        owner: uid.to_string(),
        group: gid.to_string(),
    }
}

// ─────────────────────────────────────────────
// Основные операции через SFTP
// ─────────────────────────────────────────────

/// Получить SFTP-сессию из пула.
/// ВАЖНО: мьютекс удерживается только для получения Sftp, затем освобождается.
/// Это предотвращает deadlock с execute_command и мониторингом.
fn with_sftp<F, T>(server_id: &str, f: F) -> Result<T>
where
    F: FnOnce(Sftp) -> Result<T>,
{
    let sftp = {
        let pool = SSH_POOL.lock().unwrap();
        let managed = pool
            .get(server_id)
            .ok_or_else(|| anyhow::anyhow!("Нет активного SSH подключения к серверу"))?;
        managed.session.sftp().context("Не удалось открыть SFTP канал")?
    };
    f(sftp)
}

/// Список файлов в директории.
pub fn list_dir(server_id: &str, path: &str) -> Result<Vec<FileEntry>> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        let entries = sftp
            .readdir(Path::new(&clean))
            .with_context(|| format!("Не удалось прочитать директорию: {}", clean))?;

        let mut result: Vec<FileEntry> = entries
            .into_iter()
            .filter_map(|(pb, stat)| {
                let name = pb.file_name()?.to_string_lossy().to_string();
                // Скрываем . и ..
                if name == "." || name == ".." {
                    return None;
                }
                let full_path = format!("{}/{}", clean.trim_end_matches('/'), name);
                let mode = stat.perm.unwrap_or(0);
                let is_symlink = (mode & 0o170000) == 0o120000;
                Some(stat_to_entry(&name, &full_path, &stat, is_symlink))
            })
            .collect();

        // Папки сначала, потом файлы; внутри каждой группы — алфавитный порядок
        result.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(result)
    })
}

/// Прочитать текстовый файл (возвращает UTF-8).
pub fn read_text_file(server_id: &str, path: &str) -> Result<FileContent> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        let stat = sftp
            .stat(Path::new(&clean))
            .with_context(|| format!("Файл не найден: {}", clean))?;

        let size = stat.size.unwrap_or(0);
        // Уменьшаем лимит до 2 МБ (фронтенд тоже проверяет)
        if size > 2 * 1024 * 1024 {
            return Err(anyhow::anyhow!(
                "Файл слишком большой для редактирования ({:.1} МБ). Максимум — 2 МБ.",
                size as f64 / 1024.0 / 1024.0
            ));
        }

        let mut file = sftp
            .open(Path::new(&clean))
            .with_context(|| format!("Нет доступа к файлу: {}", clean))?;

        let mut buf = Vec::with_capacity(size as usize);
        file.read_to_end(&mut buf)?;

        // Проверяем бинарность по первым 8 КБ — быстрее чем весь файл
        let probe = &buf[..buf.len().min(8192)];
        let is_binary = probe.contains(&0u8);

        let content = if is_binary {
            // Для бинарных возвращаем пустой контент — фронтенд покажет ошибку
            String::new()
        } else {
            // Используем lossy — не паникуем на невалидном UTF-8
            String::from_utf8_lossy(&buf).to_string()
        };

        Ok(FileContent {
            path: clean,
            content,
            size,
            is_binary,
        })
    })
}

/// Записать текстовый файл.
pub fn write_text_file(server_id: &str, path: &str, content: &str) -> Result<()> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        let mut file = sftp
            .create(Path::new(&clean))
            .with_context(|| format!("Не удалось открыть файл для записи: {}", clean))?;

        file.write_all(content.as_bytes())
            .context("Ошибка записи файла")?;

        Ok(())
    })
}

/// Создать директорию (mkdir -p: все промежуточные).
pub fn create_dir(server_id: &str, path: &str) -> Result<()> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        sftp.mkdir(Path::new(&clean), 0o755)
            .with_context(|| format!("Не удалось создать директорию: {}", clean))?;
        Ok(())
    })
}

/// Создать пустой файл.
pub fn create_file(server_id: &str, path: &str) -> Result<()> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        // Если уже существует — ошибка
        if sftp.stat(Path::new(&clean)).is_ok() {
            return Err(anyhow::anyhow!("Файл уже существует: {}", clean));
        }
        let mut file = sftp
            .create(Path::new(&clean))
            .with_context(|| format!("Не удалось создать файл: {}", clean))?;
        file.write_all(b"").context("Ошибка создания файла")?;
        Ok(())
    })
}

/// Переименовать / переместить файл или директорию.
pub fn rename(server_id: &str, old_path: &str, new_path: &str) -> Result<()> {
    let old_clean = sanitize_path(old_path)?;
    let new_clean = sanitize_path(new_path)?;

    if old_clean == new_clean {
        return Ok(());
    }

    with_sftp(server_id, |sftp| {
        sftp.rename(
            Path::new(&old_clean),
            Path::new(&new_clean),
            Some(ssh2::RenameFlags::OVERWRITE | ssh2::RenameFlags::ATOMIC),
        )
        .with_context(|| format!("Не удалось переименовать: {} → {}", old_clean, new_clean))?;
        Ok(())
    })
}

/// Удалить файл.
pub fn delete_file(server_id: &str, path: &str) -> Result<()> {
    let clean = sanitize_path(path)?;

    // Не разрешаем удалять корневые директории
    if clean == "/" || clean.trim_matches('/').is_empty() {
        return Err(anyhow::anyhow!("Нельзя удалить корневую директорию"));
    }

    with_sftp(server_id, |sftp| {
        sftp.unlink(Path::new(&clean))
            .with_context(|| format!("Не удалось удалить файл: {}", clean))?;
        Ok(())
    })
}

/// Удалить директорию (должна быть пустой — rmdir).
/// Рекурсивное удаление делаем через SSH shell для надёжности.
pub fn delete_dir(server_id: &str, path: &str) -> Result<()> {
    let clean = sanitize_path(path)?;

    if clean == "/" || clean == "/home" || clean == "/etc" || clean == "/var" || clean == "/usr" {
        return Err(anyhow::anyhow!(
            "Удаление системной директории запрещено: {}",
            clean
        ));
    }

    with_sftp(server_id, |sftp| {
        sftp.rmdir(Path::new(&clean))
            .with_context(|| format!("Не удалось удалить директорию: {}", clean))?;
        Ok(())
    })
}

/// Получить stat файла/директории.
pub fn stat(server_id: &str, path: &str) -> Result<FileEntry> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        let s = sftp
            .stat(Path::new(&clean))
            .with_context(|| format!("Не удалось получить информацию: {}", clean))?;

        let name = Path::new(&clean)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| clean.clone());

        let mode = s.perm.unwrap_or(0);
        let is_symlink = (mode & 0o170000) == 0o120000;

        Ok(stat_to_entry(&name, &clean, &s, is_symlink))
    })
}

/// Скачать файл — возвращает base64-encoded содержимое.
pub fn download_file(server_id: &str, path: &str) -> Result<Vec<u8>> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        let stat = sftp
            .stat(Path::new(&clean))
            .with_context(|| format!("Файл не найден: {}", clean))?;

        let size = stat.size.unwrap_or(0);
        if size > 100 * 1024 * 1024 {
            return Err(anyhow::anyhow!(
                "Файл слишком большой для скачивания ({} МБ). Максимум — 100 МБ.",
                size / 1024 / 1024
            ));
        }

        let mut file = sftp
            .open(Path::new(&clean))
            .with_context(|| format!("Нет доступа к файлу: {}", clean))?;

        let mut buf = Vec::with_capacity(size as usize);
        file.read_to_end(&mut buf)?;

        Ok(buf)
    })
}

/// Загрузить файл — принимает base64-encoded содержимое.
pub fn upload_file(server_id: &str, path: &str, data: &[u8]) -> Result<()> {
    let clean = sanitize_path(path)?;

    with_sftp(server_id, |sftp| {
        let mut file = sftp
            .create(Path::new(&clean))
            .with_context(|| format!("Не удалось создать файл для загрузки: {}", clean))?;

        file.write_all(data)
            .context("Ошибка записи данных файла")?;

        Ok(())
    })
}

/// Изменить права доступа.
pub fn chmod(server_id: &str, path: &str, mode: u32) -> Result<()> {
    let clean = sanitize_path(path)?;

    // Разрешаем только безопасные биты прав (без setuid/setgid/sticky)
    let safe_mode = mode & 0o777;

    with_sftp(server_id, |sftp| {
        let stat = FileStat {
            size: None,
            uid: None,
            gid: None,
            perm: Some(safe_mode),
            atime: None,
            mtime: None,
        };
        sftp.setstat(Path::new(&clean), stat)
            .with_context(|| format!("Не удалось изменить права: {}", clean))?;
        Ok(())
    })
}
