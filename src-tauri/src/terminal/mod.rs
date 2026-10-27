use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ssh2::Channel;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use once_cell::sync::Lazy;

/// Пул PTY-сессий (session_id → открытый канал)
static PTY_POOL: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub struct PtySession {
    pub channel: Channel,
    #[allow(dead_code)]
    pub server_id: String,
    #[allow(dead_code)]
    pub session_id: String,
}

unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PtyStartResult {
    pub session_id: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Открыть PTY-сессию на сервере.
pub fn start_pty(server_id: &str, rows: u32, cols: u32) -> Result<String> {
    use crate::ssh::SSH_POOL;
    use uuid::Uuid;

    let pool = SSH_POOL.lock().unwrap();
    let managed = pool
        .get(server_id)
        .ok_or_else(|| anyhow::anyhow!("Нет активного SSH подключения"))?;

    let mut channel = managed
        .session
        .channel_session()
        .context("Не удалось открыть канал")?;

    // Запрашиваем PTY
    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((cols, rows, cols * 8, rows * 16)),
        )
        .context("Не удалось запросить PTY")?;

    // Запускаем shell
    channel
        .shell()
        .context("Не удалось запустить shell")?;

    // Неблокирующий режим чтения
    channel.handle_extended_data(ssh2::ExtendedData::Merge)
        .context("Не удалось настроить extended data")?;

    let session_id = Uuid::new_v4().to_string();

    let mut pty_pool = PTY_POOL.lock().unwrap();
    pty_pool.insert(session_id.clone(), PtySession {
        channel,
        server_id: server_id.to_string(),
        session_id: session_id.clone(),
    });

    Ok(session_id)
}

/// Записать данные в PTY (пользовательский ввод).
pub fn write_pty(session_id: &str, data: &[u8]) -> Result<()> {
    let mut pool = PTY_POOL.lock().unwrap();
    let sess = pool
        .get_mut(session_id)
        .ok_or_else(|| anyhow::anyhow!("PTY сессия не найдена: {}", session_id))?;

    sess.channel
        .write_all(data)
        .context("Ошибка записи в PTY")?;

    Ok(())
}

/// Прочитать доступные данные из PTY (неблокирующий).
pub fn read_pty(session_id: &str) -> Result<Vec<u8>> {
    let mut pool = PTY_POOL.lock().unwrap();
    let sess = pool
        .get_mut(session_id)
        .ok_or_else(|| anyhow::anyhow!("PTY сессия не найдена: {}", session_id))?;

    // Переключаем сессию в неблокирующий режим для чтения
    sess.channel.stream(0).flush().ok();

    let mut buf = vec![0u8; 8192];
    match sess.channel.read(&mut buf) {
        Ok(0) => Ok(vec![]),
        Ok(n) => Ok(buf[..n].to_vec()),
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(vec![]),
        Err(e) => Err(anyhow::anyhow!("Ошибка чтения PTY: {}", e)),
    }
}

/// Изменить размер PTY.
pub fn resize_pty(session_id: &str, rows: u32, cols: u32) -> Result<()> {
    let mut pool = PTY_POOL.lock().unwrap();
    let sess = pool
        .get_mut(session_id)
        .ok_or_else(|| anyhow::anyhow!("PTY сессия не найдена"))?;

    sess.channel
        .request_pty_size(cols, rows, Some(cols * 8), Some(rows * 16))
        .context("Ошибка изменения размера PTY")?;

    Ok(())
}

/// Закрыть PTY-сессию.
pub fn close_pty(session_id: &str) {
    let mut pool = PTY_POOL.lock().unwrap();
    if let Some(mut sess) = pool.remove(session_id) {
        // Отправляем exit команду
        let _ = sess.channel.write_all(b"exit\n");
        let _ = sess.channel.close();
        let _ = sess.channel.wait_close();
    }
}

/// Проверить что PTY сессия жива.
pub fn is_pty_alive(session_id: &str) -> bool {
    let pool = PTY_POOL.lock().unwrap();
    if let Some(sess) = pool.get(session_id) {
        !sess.channel.eof()
    } else {
        false
    }
}

/// Закрыть все PTY сессии для сервера.
#[allow(dead_code)]
pub fn close_all_for_server(server_id: &str) {
    let mut pool = PTY_POOL.lock().unwrap();
    let to_remove: Vec<String> = pool
        .iter()
        .filter(|(_, s)| s.server_id == server_id)
        .map(|(k, _)| k.clone())
        .collect();

    for key in to_remove {
        if let Some(mut sess) = pool.remove(&key) {
            let _ = sess.channel.close();
        }
    }
}
