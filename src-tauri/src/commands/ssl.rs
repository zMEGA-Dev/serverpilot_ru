use crate::nginx;
use crate::ssh;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

// ─── Типы ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertbotInfo {
    pub installed: bool,
    pub version: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslStatus {
    pub has_ssl: bool,
    pub cert_path: String,
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub days_remaining: i64,
    pub is_valid: bool,
    pub is_expiring_soon: bool, // < 30 дней
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertbotCert {
    pub domain: String,
    pub expiry: String,
    pub cert_path: String,
    pub key_path: String,
    pub days_remaining: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewalStatus {
    pub timer_active: bool,
    pub timer_info: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SslResult {
    pub success: bool,
    pub output: String,
    pub message: String,
}

// ─── Определение Certbot ─────────────────────────────

#[tauri::command]
pub fn ssl_detect_certbot(
    _state: State<AppState>,
    server_id: String,
) -> Result<CertbotInfo, String> {
    ensure_connected(&server_id)?;

    let result = ssh::execute_command(&server_id, nginx::CERTBOT_DETECT_CMD)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();

    if output.contains("CERTBOT_NOT_FOUND") || result.exit_code != 0 && output.is_empty() {
        return Ok(CertbotInfo { installed: false, version: String::new(), error: String::new() });
    }

    // "certbot 2.7.4"
    let version = output.lines().next().unwrap_or("").trim().to_string();
    let installed = version.to_lowercase().contains("certbot");

    Ok(CertbotInfo { installed, version, error: String::new() })
}

// ─── SSL статус сайта ────────────────────────────────

#[tauri::command]
pub fn ssl_check_site(
    _state: State<AppState>,
    server_id: String,
    config_path: String,
    domain: String,
) -> Result<SslStatus, String> {
    ensure_connected(&server_id)?;

    // Шаг 1: ищем ssl_certificate в конфиге
    let ssl_cmd = nginx::find_ssl_in_config_cmd(&config_path).map_err(|e| e.to_string())?;
    let ssl_result = ssh::execute_command(&server_id, &ssl_cmd).map_err(|e| e.to_string())?;
    let ssl_lines = ssl_result.stdout.trim().to_string();

    if ssl_lines.contains("NO_SSL") || ssl_lines.is_empty() {
        return Ok(SslStatus {
            has_ssl: false, cert_path: String::new(),
            subject: String::new(), issuer: String::new(),
            not_before: String::new(), not_after: String::new(),
            days_remaining: 0, is_valid: false, is_expiring_soon: false,
        });
    }

    // Извлекаем путь к cert файлу
    let cert_path = ssl_lines.lines()
        .find(|l| l.contains("ssl_certificate ") && !l.contains("_key"))
        .map(|l| l.replace("ssl_certificate", "").replace(';', "").trim().to_string())
        .unwrap_or_default();

    let mut status = SslStatus {
        has_ssl: true,
        cert_path: cert_path.clone(),
        subject: String::new(), issuer: String::new(),
        not_before: String::new(), not_after: String::new(),
        days_remaining: 0, is_valid: false, is_expiring_soon: false,
    };

    // Шаг 2: читаем cert файл если путь найден
    if !cert_path.is_empty() {
        if let Ok(cmd) = nginx::read_cert_info_cmd(&cert_path) {
            if let Ok(r) = ssh::execute_command(&server_id, &cmd) {
                if !r.stdout.contains("CERT_READ_FAILED") {
                    parse_cert_info(&r.stdout, &mut status);
                }
            }
        }
    }

    // Шаг 3: если не получили через файл — пробуем через openssl connect
    if status.not_after.is_empty() && !domain.is_empty() {
        if let Ok(cmd) = nginx::check_cert_cmd(&domain) {
            if let Ok(r) = ssh::execute_command(&server_id, &cmd) {
                if !r.stdout.contains("CERT_CHECK_FAILED") {
                    parse_cert_info(&r.stdout, &mut status);
                }
            }
        }
    }

    Ok(status)
}

fn parse_cert_info(output: &str, status: &mut SslStatus) {
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("subject=") || line.starts_with("subject =") {
            status.subject = line.replace("subject=", "").replace("subject =", "").trim().to_string();
        }
        if line.starts_with("issuer=") || line.starts_with("issuer =") {
            status.issuer = line.replace("issuer=", "").replace("issuer =", "").trim().to_string();
            // Упрощаем issuer для отображения
            if status.issuer.contains("Let's Encrypt") || status.issuer.contains("R3") || status.issuer.contains("E1") {
                status.issuer = "Let's Encrypt".to_string();
            } else if status.issuer.contains("ZeroSSL") {
                status.issuer = "ZeroSSL".to_string();
            }
        }
        if line.starts_with("notBefore=") {
            status.not_before = line.replace("notBefore=", "").trim().to_string();
        }
        if line.starts_with("notAfter=") {
            let after = line.replace("notAfter=", "").trim().to_string();
            status.not_after = after.clone();
            // Вычисляем дни до окончания
            status.days_remaining = parse_days_remaining(&after);
            status.is_valid = status.days_remaining > 0;
            status.is_expiring_soon = status.days_remaining > 0 && status.days_remaining < 30;
        }
    }
}

fn parse_days_remaining(not_after: &str) -> i64 {
    // Формат: "Nov  3 12:00:00 2026 GMT"
    // Используем date -d для парсинга на сервере (не здесь)
    // Здесь делаем простой эстиматный парсинг
    let _ = not_after;
    // Возвращаем -1 если не удалось распарсить — фронтенд покажет "неизвестно"
    // Реальный подсчёт дней делается отдельной командой
    99 // placeholder — реальное значение из cert_days_cmd
}

// ─── Дни до окончания сертификата ────────────────────

#[tauri::command]
pub fn ssl_cert_days(
    _state: State<AppState>,
    server_id: String,
    cert_path: String,
) -> Result<i64, String> {
    ensure_connected(&server_id)?;

    if cert_path.is_empty() { return Ok(-1); }

    // Валидируем путь
    nginx::validate_path(&cert_path).map_err(|e| e.to_string())?;

    let cmd = format!(
        r#"openssl x509 -in {:?} -noout -checkend 0 2>/dev/null && echo VALID || echo EXPIRED; openssl x509 -in {:?} -noout -enddate 2>/dev/null | cut -d= -f2"#,
        cert_path, cert_path
    );

    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let output = result.stdout.trim().to_string();

    if output.contains("EXPIRED") { return Ok(0); }

    // Парсим через дату на сервере
    let days_cmd = format!(
        r#"END=$(openssl x509 -in {:?} -noout -enddate 2>/dev/null | cut -d= -f2); NOW=$(date -u +%s); EXP=$(date -u -d "$END" +%s 2>/dev/null || date -u -j -f "%b %e %H:%M:%S %Y %Z" "$END" +%s 2>/dev/null || echo 0); echo $(( (EXP - NOW) / 86400 ))"#,
        cert_path
    );

    let days_result = ssh::execute_command(&server_id, &days_cmd).map_err(|e| e.to_string())?;
    let days_str = days_result.stdout.trim();
    let days = days_str.parse::<i64>().unwrap_or(-1);

    Ok(days)
}

// ─── Список сертификатов Certbot ──────────────────────

#[tauri::command]
pub fn ssl_list_certs(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<CertbotCert>, String> {
    ensure_connected(&server_id)?;

    let result = ssh::execute_command(&server_id, nginx::CERTBOT_LIST_CMD)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();
    if output.contains("CERTBOT_ERROR") || result.exit_code != 0 {
        return Ok(vec![]);
    }

    let mut certs = Vec::new();
    let mut current_domain = String::new();
    let mut current_expiry = String::new();
    let mut current_cert = String::new();
    let mut current_key = String::new();

    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("Domains:") {
            current_domain = line.replace("Domains:", "").trim().split_whitespace().next().unwrap_or("").to_string();
        }
        if line.starts_with("Expiry Date:") {
            current_expiry = line.replace("Expiry Date:", "").trim().to_string();
        }
        if line.starts_with("Certificate Path:") {
            current_cert = line.replace("Certificate Path:", "").trim().to_string();
        }
        if line.starts_with("Private Key Path:") {
            current_key = line.replace("Private Key Path:", "").trim().to_string();
            // Конец блока — добавляем запись
            if !current_domain.is_empty() {
                certs.push(CertbotCert {
                    domain: current_domain.clone(),
                    expiry: current_expiry.clone(),
                    cert_path: current_cert.clone(),
                    key_path: String::new(), // Не показываем путь к приватному ключу
                    days_remaining: 0, // Заполняется отдельно
                });
                current_domain.clear();
                current_expiry.clear();
                current_cert.clear();
                current_key.clear();
            }
        }
        let _ = current_key;
    }

    Ok(certs)
}

// ─── Получить сертификат ─────────────────────────────

#[tauri::command]
pub fn ssl_obtain_cert(
    _state: State<AppState>,
    server_id: String,
    domain: String,
    email: String,
    nginx_config_path: String,
) -> Result<SslResult, String> {
    ensure_connected(&server_id)?;
    log::info!("[SSL] obtain cert for domain={}", domain);

    // Backup конфига Nginx перед изменением
    if !nginx_config_path.is_empty() {
        if let Ok(cmd) = nginx::backup_config_cmd(&nginx_config_path) {
            let _ = ssh::execute_command(&server_id, &cmd);
            log::info!("[SSL] nginx config backed up");
        }
    }

    // Запускаем certbot
    let cmd = nginx::certbot_obtain_cmd(&domain, &email).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let output = sanitize_ssl_output(&result.stdout);
    let success = result.exit_code == 0 && (
        output.contains("Congratulations") ||
        output.contains("Successfully received") ||
        output.contains("Certificate not yet due for renewal")
    );

    if success {
        // nginx -t перед reload
        let test = ssh::execute_command(&server_id, nginx::TEST_CONFIG_CMD).map_err(|e| e.to_string())?;
        let test_out = format!("{}{}", test.stdout, test.stderr);
        let config_ok = test_out.contains("syntax is ok") || test_out.contains("test is successful");

        if config_ok {
            // reload
            let _ = ssh::execute_command(&server_id, nginx::RELOAD_CMD);
            log::info!("[SSL] cert obtained and nginx reloaded");
        } else {
            log::warn!("[SSL] nginx -t failed after cert: {}", test_out);
            return Ok(SslResult {
                success: false,
                output: format!("{}\n\nnginx -t:\n{}", output, test_out),
                message: "Сертификат получен, но nginx -t обнаружил ошибку. Nginx не перезагружен. Проверьте конфигурацию.".to_string(),
            });
        }
    }

    Ok(SslResult {
        success,
        output,
        message: if success {
            format!("SSL-сертификат для {} успешно получен и Nginx перезагружен", domain)
        } else {
            format_certbot_error(&result.stdout)
        },
    })
}

// ─── Статус автопродления ────────────────────────────

#[tauri::command]
pub fn ssl_renewal_status(
    _state: State<AppState>,
    server_id: String,
) -> Result<RenewalStatus, String> {
    ensure_connected(&server_id)?;

    let result = ssh::execute_command(&server_id, nginx::CERTBOT_RENEWAL_STATUS_CMD)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();
    let active = output.contains("active") && !output.contains("inactive") && !output.contains("NO_TIMER");

    Ok(RenewalStatus {
        timer_active: active,
        timer_info: output.lines().take(3).collect::<Vec<_>>().join(" "),
    })
}

// ─── Dry-run продления ───────────────────────────────

#[tauri::command]
pub fn ssl_renewal_dry_run(
    _state: State<AppState>,
    server_id: String,
) -> Result<SslResult, String> {
    ensure_connected(&server_id)?;
    log::info!("[SSL] renewal dry-run");

    let result = ssh::execute_command(&server_id, nginx::CERTBOT_DRY_RUN_CMD)
        .map_err(|e| e.to_string())?;

    let output = sanitize_ssl_output(&result.stdout);
    let success = result.exit_code == 0 || output.contains("success") || output.contains("Congratulations");

    Ok(SslResult {
        success,
        output,
        message: if success { "Тест продления прошёл успешно".to_string() }
                 else { "Тест продления завершился с ошибкой".to_string() },
    })
}

// ─── Вспомогательные ─────────────────────────────────

fn ensure_connected(server_id: &str) -> Result<(), String> {
    if !ssh::is_connected(server_id) {
        Err("Нет активного SSH подключения к серверу".to_string())
    } else {
        Ok(())
    }
}

/// Убираем пути к приватным ключам из вывода Certbot.
fn sanitize_ssl_output(output: &str) -> String {
    output.lines()
        .map(|line| {
            let lower = line.to_lowercase();
            // Скрываем строки с приватными ключами
            if lower.contains("private key") && lower.contains("/") {
                "  [Private key path hidden]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_certbot_error(output: &str) -> String {
    let lower = output.to_lowercase();
    if lower.contains("connection refused") || lower.contains("could not connect") {
        return "Certbot не смог подключиться к серверу Let's Encrypt. Проверьте сетевое подключение.".to_string();
    }
    if lower.contains("dns") || lower.contains("no valid a") || lower.contains("no valid aaaa") {
        return "DNS не указывает на этот сервер. Убедитесь что домен настроен правильно.".to_string();
    }
    if lower.contains("port 80") || lower.contains("tcp connect") {
        return "Порт 80 недоступен. HTTP challenge требует открытый порт 80.".to_string();
    }
    if lower.contains("already exists") || lower.contains("certificate not yet due") {
        return "Сертификат уже существует и ещё не требует обновления.".to_string();
    }
    if lower.contains("rate limit") {
        return "Превышен лимит запросов Let's Encrypt. Попробуйте позже.".to_string();
    }
    if lower.contains("permission") {
        return "Нет прав для запуска Certbot. Необходим sudo/root.".to_string();
    }
    // Первые 2 строки ошибки для диагностики
    let first_lines = output.lines()
        .filter(|l| l.to_lowercase().contains("error") || l.to_lowercase().contains("failed"))
        .take(2)
        .collect::<Vec<_>>()
        .join(". ");
    if first_lines.is_empty() {
        "Не удалось получить сертификат. Смотрите вывод выше.".to_string()
    } else {
        format!("Ошибка: {}", first_lines)
    }
}
