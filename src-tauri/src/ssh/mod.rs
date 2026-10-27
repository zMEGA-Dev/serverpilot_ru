use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

/// Глобальный пул SSH-соединений (server_id → сессия)
pub static SSH_POOL: Lazy<Mutex<HashMap<String, ManagedSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub struct ManagedSession {
    pub session: Session,
    #[allow(dead_code)]
    pub server_id: String,
}

unsafe impl Send for ManagedSession {}
unsafe impl Sync for ManagedSession {}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SshConnectionParams {
    pub server_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SshConnectionResult {
    pub success: bool,
    pub server_id: String,
    pub fingerprint: Option<String>,
    pub banner: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

/// Подключиться к SSH-серверу и вернуть результат.
pub fn connect(params: &SshConnectionParams) -> Result<SshConnectionResult> {
    let addr = format!("{}:{}", params.host, params.port);

    let tcp = TcpStream::connect(&addr)
        .with_context(|| format!("Не удалось подключиться к {}:{}", params.host, params.port))?;

    // Таймаут на TCP
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))?;

    let mut session = Session::new().context("Не удалось создать SSH сессию")?;

    // Включаем blocking mode — предотвращает гонку состояний при первом подключении
    session.set_blocking(true);

    session.set_tcp_stream(tcp);
    session.handshake().context("SSH handshake не удался")?;

    // Получаем fingerprint
    let fingerprint = session
        .host_key_hash(ssh2::HashType::Sha256)
        .map(|h| hex::encode(h));

    let banner = session.banner().map(|s| s.to_string());

    // Аутентификация
    match params.auth_type.as_str() {
        "password" => {
            let password = params
                .password
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("Пароль не указан"))?;

            session
                .userauth_password(&params.username, password)
                .context("Ошибка аутентификации по паролю. Проверьте логин и пароль.")?;
        }
        "key" => {
            let key_path = params
                .key_path
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("Путь к ключу не указан"))?;

            let passphrase = params.key_passphrase.as_deref();

            session
                .userauth_pubkey_file(
                    &params.username,
                    None,
                    std::path::Path::new(key_path),
                    passphrase,
                )
                .context("Ошибка аутентификации по ключу")?;
        }
        "agent" => {
            let mut agent = session.agent().context("Не удалось подключиться к SSH-агенту")?;
            agent.connect().context("SSH-агент недоступен")?;
            agent.list_identities().context("Не удалось получить список ключей от агента")?;

            let identities = agent.identities()?;
            let mut authenticated = false;

            for identity in identities {
                if agent.userauth(&params.username, &identity).is_ok() {
                    authenticated = true;
                    break;
                }
            }

            if !authenticated {
                return Err(anyhow::anyhow!("SSH-агент не смог аутентифицировать пользователя"));
            }
        }
        _ => {
            return Err(anyhow::anyhow!("Неизвестный тип аутентификации: {}", params.auth_type));
        }
    }

    if !session.authenticated() {
        return Err(anyhow::anyhow!("Аутентификация не прошла"));
    }

    // Keepalive — предотвращает разрыв соединения при простое
    session.set_keepalive(true, 15);

    // Сохраняем сессию в пул (заменяем если уже есть)
    {
        let mut pool = SSH_POOL.lock().unwrap();
        pool.insert(params.server_id.clone(), ManagedSession {
            session,
            server_id: params.server_id.clone(),
        });
    }

    Ok(SshConnectionResult {
        success: true,
        server_id: params.server_id.clone(),
        fingerprint,
        banner,
        error: None,
    })
}

/// Выполнить команду на подключённом сервере.
pub fn execute_command(server_id: &str, command: &str) -> Result<CommandResult> {
    let start = std::time::Instant::now();

    let mut pool = SSH_POOL.lock().unwrap();
    let managed = pool
        .get_mut(server_id)
        .ok_or_else(|| anyhow::anyhow!("Нет активного подключения к серверу {}", server_id))?;

    let mut channel = managed
        .session
        .channel_session()
        .context("Не удалось открыть SSH канал")?;

    channel.exec(command).context("Не удалось выполнить команду")?;

    let mut stdout = String::new();
    let mut stderr = String::new();

    channel.read_to_string(&mut stdout)?;
    channel.stderr().read_to_string(&mut stderr)?;

    channel.wait_close()?;
    let exit_code = channel.exit_status().unwrap_or(-1);

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(CommandResult {
        stdout,
        stderr,
        exit_code,
        duration_ms,
    })
}

/// Открыть PTY-канал и выполнить команду с полноценным терминалом.
#[allow(dead_code)]
pub fn execute_pty(server_id: &str, command: &str, rows: u32, cols: u32) -> Result<CommandResult> {
    let start = std::time::Instant::now();

    let mut pool = SSH_POOL.lock().unwrap();
    let managed = pool
        .get_mut(server_id)
        .ok_or_else(|| anyhow::anyhow!("Нет активного подключения"))?;

    let mut channel = managed
        .session
        .channel_session()
        .context("Не удалось открыть канал")?;

    // Запрашиваем PTY — это позволяет выполнять интерактивные команды
    channel
        .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
        .context("Не удалось запросить PTY")?;

    channel.exec(command).context("Не удалось выполнить команду")?;

    let mut output = Vec::new();
    let mut buf = [0u8; 4096];

    loop {
        match channel.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => output.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(_) => break,
        }
    }

    channel.wait_close().ok();
    let exit_code = channel.exit_status().unwrap_or(-1);
    let duration_ms = start.elapsed().as_millis() as u64;

    let stdout = String::from_utf8_lossy(&output).to_string();

    Ok(CommandResult {
        stdout,
        stderr: String::new(),
        exit_code,
        duration_ms,
    })
}

/// Записать данные в stdin запущенного канала.
#[allow(dead_code)]
pub fn write_channel(_server_id: &str, _data: &[u8]) -> Result<()> {
    Ok(())
}

/// Проверить доступность SSH без сохранения сессии.
pub fn test_connection(params: &SshConnectionParams) -> SshConnectionResult {
    match connect(params) {
        Ok(result) => {
            // Сразу отключаемся — это только тест
            disconnect(&params.server_id);
            SshConnectionResult {
                success: true,
                ..result
            }
        }
        Err(e) => SshConnectionResult {
            success: false,
            server_id: params.server_id.clone(),
            fingerprint: None,
            banner: None,
            error: Some(format_error_message(&e.to_string())),
        },
    }
}

/// Отключиться от сервера.
pub fn disconnect(server_id: &str) {
    let mut pool = SSH_POOL.lock().unwrap();
    if let Some(managed) = pool.remove(server_id) {
        let _ = managed.session.disconnect(
            None,
            "Пользователь отключился",
            None,
        );
    }
}

/// Проверить, есть ли активное подключение.
pub fn is_connected(server_id: &str) -> bool {
    let pool = SSH_POOL.lock().unwrap();
    pool.contains_key(server_id)
}

/// Преобразовать технические ошибки в понятные пользователю сообщения.
fn format_error_message(error: &str) -> String {
    if error.contains("Connection refused") || error.contains("ECONNREFUSED") {
        return "Сервер отклонил подключение. Проверьте: SSH-сервис запущен, порт верный, firewall не блокирует.".to_string();
    }
    if error.contains("timed out") || error.contains("timeout") {
        return "Время ожидания истекло. Сервер недоступен или порт заблокирован.".to_string();
    }
    if error.contains("No route to host") {
        return "Нет маршрута до сервера. Проверьте IP-адрес и сетевое подключение.".to_string();
    }
    if error.contains("Authentication") || error.contains("auth") {
        return "Ошибка аутентификации. Проверьте логин, пароль или SSH-ключ.".to_string();
    }
    if error.contains("Host key") {
        return "Изменился SSH-ключ сервера. Возможная MITM-атака или пересозданный сервер.".to_string();
    }
    error.to_string()
}
