use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use uuid::Uuid;

// ─── PTY пул — отдельный от SSH_POOL ────────────────
// Каждая PTY сессия имеет СВОЁ SSH соединение.
// Это принципиально — libssh2 не потокобезопасна при
// одновременном доступе к одной Session из разных потоков.

static PTY_SESSIONS: Lazy<Mutex<HashMap<String, PtySession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub struct PtySession {
    _session: Session,
    pub channel: ssh2::Channel,
    #[allow(dead_code)]
    pub server_id: String,
}

unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyOpenParams {
    pub server_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    pub rows: u32,
    pub cols: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PtyReadResult {
    /// base64-encoded данные от сервера (stdout+stderr merged через PTY)
    pub data: String,
    /// Жива ли PTY сессия
    pub alive: bool,
}

// ─── Открыть PTY сессию ──────────────────────────────

pub fn open(params: &PtyOpenParams) -> Result<String> {
    let addr = format!("{}:{}", params.host, params.port);

    let tcp = TcpStream::connect(&addr)
        .with_context(|| format!("PTY: не удалось подключиться к {}:{}", params.host, params.port))?;

    tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))?;

    let mut session = Session::new().context("PTY: не удалось создать SSH сессию")?;
    session.set_blocking(true);
    session.set_tcp_stream(tcp);
    session.handshake().context("PTY: SSH handshake не удался")?;

    // Аутентификация — та же логика что в ssh/mod.rs
    match params.auth_type.as_str() {
        "password" => {
            let pw = params.password.as_deref()
                .ok_or_else(|| anyhow::anyhow!("Пароль не указан"))?;
            session.userauth_password(&params.username, pw)
                .context("PTY: ошибка аутентификации по паролю")?;
        }
        "key" => {
            let key = params.key_path.as_deref()
                .ok_or_else(|| anyhow::anyhow!("Путь к ключу не указан"))?;
            let passphrase = params.key_passphrase.as_deref();
            session.userauth_pubkey_file(
                &params.username, None,
                std::path::Path::new(key), passphrase,
            ).context("PTY: ошибка аутентификации по ключу")?;
        }
        "agent" => {
            let mut agent = session.agent().context("PTY: SSH-агент недоступен")?;
            agent.connect()?;
            agent.list_identities()?;
            let identities = agent.identities()?;
            let mut ok = false;
            for id in identities {
                if agent.userauth(&params.username, &id).is_ok() {
                    ok = true;
                    break;
                }
            }
            if !ok { return Err(anyhow::anyhow!("PTY: SSH-агент не смог аутентифицировать")); }
        }
        _ => return Err(anyhow::anyhow!("PTY: неизвестный тип аутентификации")),
    }

    if !session.authenticated() {
        return Err(anyhow::anyhow!("PTY: аутентификация не прошла"));
    }

    session.set_keepalive(true, 15);

    // Открываем канал
    let mut channel = session.channel_session()
        .context("PTY: не удалось открыть канал")?;

    // Запрашиваем PTY с xterm-256color
    let rows = params.rows.max(1).min(500);
    let cols = params.cols.max(1).min(500);
    channel.request_pty(
        "xterm-256color",
        None,
        Some((cols, rows, cols * 8, rows * 16)),
    ).context("PTY: не удалось запросить PTY")?;

    // Запускаем интерактивный shell пользователя
    // shell() использует $SHELL или /bin/sh по умолчанию — не хардкодим bash
    channel.shell().context("PTY: не удалось запустить shell")?;

    // Неблокирующий режим для чтения — чтобы poll не блокировал
    session.set_blocking(false);

    let session_id = Uuid::new_v4().to_string();

    {
        let mut pool = PTY_SESSIONS.lock().unwrap();
        pool.insert(session_id.clone(), PtySession {
            _session: session,
            channel,
            server_id: params.server_id.clone(),
        });
    }

    log::info!("[PTY] opened session {} for server {}", session_id, params.server_id);
    Ok(session_id)
}

// ─── Запись в PTY (ввод пользователя) ────────────────

pub fn write(session_id: &str, data: &[u8]) -> Result<()> {
    let mut pool = PTY_SESSIONS.lock().unwrap();
    let sess = pool.get_mut(session_id)
        .ok_or_else(|| anyhow::anyhow!("PTY сессия не найдена: {}", session_id))?;

    sess.channel.write_all(data)
        .context("PTY: ошибка записи")?;

    // flush не нужен для PTY — данные идут сразу
    Ok(())
}

// ─── Чтение из PTY (вывод сервера) ───────────────────

pub fn read(session_id: &str) -> Result<(Vec<u8>, bool)> {
    let mut pool = PTY_SESSIONS.lock().unwrap();
    let sess = pool.get_mut(session_id)
        .ok_or_else(|| anyhow::anyhow!("PTY сессия не найдена: {}", session_id))?;

    // Проверяем закрыт ли канал
    if sess.channel.eof() {
        return Ok((vec![], false));
    }

    let mut buf = vec![0u8; 16384]; // 16KB буфер
    match sess.channel.read(&mut buf) {
        Ok(0) => Ok((vec![], true)),
        Ok(n) => Ok((buf[..n].to_vec(), true)),
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            Ok((vec![], true)) // нет данных сейчас — это нормально
        }
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
            Ok((vec![], true))
        }
        Err(e) => {
            // Любая другая ошибка — сессия закрылась
            log::warn!("[PTY] read error for {}: {}", session_id, e);
            Ok((vec![], false))
        }
    }
}

// ─── Resize PTY ──────────────────────────────────────

pub fn resize(session_id: &str, rows: u32, cols: u32) -> Result<()> {
    let mut pool = PTY_SESSIONS.lock().unwrap();
    let sess = pool.get_mut(session_id)
        .ok_or_else(|| anyhow::anyhow!("PTY сессия не найдена"))?;

    let rows = rows.max(1).min(500);
    let cols = cols.max(1).min(500);

    sess.channel.request_pty_size(cols, rows, Some(cols * 8), Some(rows * 16))
        .context("PTY: ошибка resize")?;

    Ok(())
}

// ─── Закрыть PTY сессию ──────────────────────────────

pub fn close(session_id: &str) {
    let mut pool = PTY_SESSIONS.lock().unwrap();
    if let Some(mut sess) = pool.remove(session_id) {
        // Отправляем EOF и закрываем канал
        let _ = sess.channel.send_eof();
        let _ = sess.channel.close();
        let _ = sess.channel.wait_close();
        log::info!("[PTY] closed session {}", session_id);
    }
}

// ─── Проверка ────────────────────────────────────────

pub fn is_alive(session_id: &str) -> bool {
    let pool = PTY_SESSIONS.lock().unwrap();
    if let Some(sess) = pool.get(session_id) {
        !sess.channel.eof()
    } else {
        false
    }
}

#[allow(dead_code)]
pub fn close_all_for_server(server_id: &str) {
    let mut pool = PTY_SESSIONS.lock().unwrap();
    let to_remove: Vec<String> = pool
        .iter()
        .filter(|(_, s)| s.server_id == server_id)
        .map(|(k, _)| k.clone())
        .collect();
    for key in to_remove {
        if let Some(mut sess) = pool.remove(&key) {
            let _ = sess.channel.send_eof();
            let _ = sess.channel.close();
        }
    }
}
