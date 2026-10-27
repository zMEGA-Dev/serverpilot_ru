use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

// ─── Валидация входных данных ────────────────────────

const FORBIDDEN_CHARS: &[char] = &[';', '&', '|', '`', '$', '(', ')', '<', '>', '\0', '\n', '\r', '\'', '"'];

pub fn validate_domain(domain: &str) -> Result<String> {
    let d = domain.trim().to_lowercase();
    if d.is_empty() { return Err(anyhow::anyhow!("Домен не может быть пустым")); }
    if d.len() > 253 { return Err(anyhow::anyhow!("Домен слишком длинный")); }
    // Только допустимые символы для домена
    let ok = d.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '*'));
    if !ok { return Err(anyhow::anyhow!("Домен содержит недопустимые символы")); }
    if d.contains("..") { return Err(anyhow::anyhow!("Недопустимый домен")); }
    Ok(d)
}

pub fn validate_port(port: u16) -> Result<u16> {
    if port == 0 { return Err(anyhow::anyhow!("Порт не может быть 0")); }
    Ok(port)
}

pub fn validate_path(path: &str) -> Result<String> {
    let p = path.trim();
    if p.is_empty() { return Err(anyhow::anyhow!("Путь не может быть пустым")); }
    if !p.starts_with('/') { return Err(anyhow::anyhow!("Путь должен быть абсолютным")); }
    if p.contains("..") { return Err(anyhow::anyhow!("Путь не может содержать '..'")); }
    if p.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return Err(anyhow::anyhow!("Путь содержит недопустимые символы"));
    }
    if p.len() > 512 { return Err(anyhow::anyhow!("Путь слишком длинный")); }
    Ok(p.to_string())
}

pub fn validate_config_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() { return Err(anyhow::anyhow!("Имя файла не может быть пустым")); }
    let ok = n.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' ));
    if !ok { return Err(anyhow::anyhow!("Имя файла содержит недопустимые символы")); }
    if n.contains("..") { return Err(anyhow::anyhow!("Недопустимое имя файла")); }
    Ok(n.to_string())
}

// ─── Определение структуры Nginx ─────────────────────

/// Определить тип конфигурации Nginx на этом сервере.
/// Возвращает: (sites_available, sites_enabled, conf_d) пути
pub const DETECT_CMD: &str = r#"
nginx -v 2>&1 | head -1;
echo "---STATUS---";
systemctl is-active nginx 2>/dev/null || service nginx status 2>/dev/null | grep -o 'running\|stopped\|inactive' | head -1 || echo "unknown";
echo "---STRUCTURE---";
test -d /etc/nginx/sites-available && echo "has_sites_available" || echo "no_sites_available";
test -d /etc/nginx/sites-enabled && echo "has_sites_enabled" || echo "no_sites_enabled";
test -d /etc/nginx/conf.d && echo "has_conf_d" || echo "no_conf_d";
echo "---CONFTEST---";
nginx -t 2>&1 | tail -2
"#;

/// Получить список сайтов из sites-available.
pub const LIST_SITES_AVAILABLE_CMD: &str = r#"
ls -la /etc/nginx/sites-available/ 2>/dev/null | awk 'NR>1 {print $NF}' | grep -v '^\.' || echo "NO_DIR"
"#;

/// Получить список из conf.d.
pub const LIST_CONF_D_CMD: &str = r#"
ls /etc/nginx/conf.d/*.conf 2>/dev/null | xargs -I{} basename {} || echo "NO_DIR"
"#;

/// Проверить включён ли сайт (есть ли симлинк в sites-enabled).
pub fn check_enabled_cmd(site_name: &str) -> Result<String> {
    let n = validate_config_name(site_name)?;
    Ok(format!("test -L /etc/nginx/sites-enabled/{n} && echo ENABLED || echo DISABLED"))
}

/// Прочитать файл конфигурации.
pub fn read_config_cmd(path: &str) -> Result<String> {
    let p = validate_path(path)?;
    Ok(format!("cat {:?} 2>&1", p))
}

/// Создать backup конфигурации перед изменением.
pub fn backup_config_cmd(path: &str) -> Result<String> {
    let p = validate_path(path)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(format!("cp {:?} {:?}.bak.{ts} 2>&1 && echo BACKUP_OK", p, p))
}

/// Записать конфигурацию безопасно через base64.
/// Контент кодируется в base64 на Rust-стороне, передаётся как аргумент,
/// декодируется на сервере через python3/base64 или openssl.
/// Это полностью исключает shell-инъекцию через содержимое конфига,
/// а также сохраняет все Nginx-переменные ($uri, $host и т.д.) без изменений.
pub fn write_config_cmd(path: &str, content: &str) -> Result<String> {
    let p = validate_path(path)?;
    // Кодируем содержимое в base64 — так передаём любой текст безопасно
    let encoded = BASE64.encode(content.as_bytes());
    // Декодируем на сервере через python3 (почти всегда доступен)
    // fallback через openssl base64 если python3 нет
    Ok(format!(
        r#"printf '%s' {encoded} | python3 -c "import sys,base64; sys.stdout.buffer.write(base64.b64decode(sys.stdin.read().strip()))" | tee {p:?} > /dev/null 2>&1 && echo WRITE_OK || printf '%s' {encoded} | openssl base64 -d | tee {p:?} > /dev/null 2>&1 && echo WRITE_OK || echo WRITE_FAILED"#,
        encoded = encoded,
        p = p,
    ))
}

/// nginx -t (всегда перед reload).
pub const TEST_CONFIG_CMD: &str = "nginx -t 2>&1";

/// nginx reload.
pub const RELOAD_CMD: &str = "nginx -s reload 2>&1 || systemctl reload nginx 2>&1";

/// Enable сайта (создать симлинк).
pub fn enable_site_cmd(site_name: &str) -> Result<String> {
    let n = validate_config_name(site_name)?;
    Ok(format!(
        "ln -sf /etc/nginx/sites-available/{n} /etc/nginx/sites-enabled/{n} 2>&1 && echo ENABLE_OK"
    ))
}

/// Disable сайта (удалить симлинк).
pub fn disable_site_cmd(site_name: &str) -> Result<String> {
    let n = validate_config_name(site_name)?;
    Ok(format!(
        "rm -f /etc/nginx/sites-enabled/{n} 2>&1 && echo DISABLE_OK"
    ))
}

/// Удалить конфигурацию сайта (только файл, НЕ файлы сайта).
pub fn delete_config_cmd(path: &str) -> Result<String> {
    let p = validate_path(path)?;
    // Убеждаемся что удаляем только из /etc/nginx/
    if !p.starts_with("/etc/nginx/") {
        return Err(anyhow::anyhow!("Можно удалять только файлы из /etc/nginx/"));
    }
    Ok(format!("rm -f {:?} 2>&1 && echo DELETE_OK", p))
}

/// Восстановить конфигурацию из backup.
pub fn restore_backup_cmd(path: &str) -> Result<String> {
    let p = validate_path(path)?;
    // Найти последний backup
    Ok(format!(
        r#"LATEST=$(ls -t {:?}.bak.* 2>/dev/null | head -1); if [ -n "$LATEST" ]; then cp "$LATEST" {:?} 2>&1 && echo "RESTORE_OK: $LATEST"; else echo "NO_BACKUP_FOUND"; fi"#,
        p, p
    ))
}

// ─── Генерация шаблона server block ──────────────────

pub fn generate_server_block(domain: &str, port: u16, root: &str) -> Result<String> {
    let d = validate_domain(domain)?;
    let p = validate_port(port)?;
    let r = validate_path(root)?;

    let www_domain = if d.starts_with("www.") {
        d.replacen("www.", "", 1)
    } else {
        format!("www.{}", d)
    };

    Ok(format!(
        r#"server {{
    listen {p};
    listen [::]:{p};

    server_name {d} {www_domain};

    root {r};
    index index.html index.htm index.php;

    location / {{
        try_files $uri $uri/ =404;
    }}

    # PHP-FPM (раскомментируйте если нужен PHP)
    # location ~ \.php$ {{
    #     include snippets/fastcgi-php.conf;
    #     fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
    # }}

    access_log /var/log/nginx/{d}.access.log;
    error_log  /var/log/nginx/{d}.error.log;
}}
"#
    ))
}

/// Сохранить новый server block в sites-available.
pub fn create_site_cmd(domain: &str, content: &str) -> Result<String> {
    let d = validate_config_name(domain)?;
    let path = format!("/etc/nginx/sites-available/{d}");
    write_config_cmd(&path, content)
}

// ─── Валидация email для Certbot ─────────────────────

pub fn validate_email(email: &str) -> Result<String> {
    let e = email.trim();
    if e.is_empty() { return Err(anyhow::anyhow!("Email не может быть пустым")); }
    if e.len() > 254 { return Err(anyhow::anyhow!("Email слишком длинный")); }
    if e.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return Err(anyhow::anyhow!("Email содержит недопустимые символы"));
    }
    if !e.contains('@') { return Err(anyhow::anyhow!("Некорректный формат email")); }
    let parts: Vec<&str> = e.splitn(2, '@').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(anyhow::anyhow!("Некорректный формат email"));
    }
    Ok(e.to_string())
}

// ─── SSL / Certbot команды ────────────────────────────

/// Определить наличие и версию Certbot.
pub const CERTBOT_DETECT_CMD: &str =
    "certbot --version 2>&1 || echo CERTBOT_NOT_FOUND";

/// Проверить статус автопродления.
pub const CERTBOT_RENEWAL_STATUS_CMD: &str =
    "systemctl status certbot.timer 2>/dev/null || systemctl status certbot 2>/dev/null || echo 'NO_TIMER'";

/// Список сертификатов Certbot.
pub const CERTBOT_LIST_CMD: &str =
    "certbot certificates 2>&1 || echo CERTBOT_ERROR";

/// Получить сертификат через Certbot для домена.
/// Используем --nginx плагин с --non-interactive.
/// domain и email прошли валидацию перед вызовом.
pub fn certbot_obtain_cmd(domain: &str, email: &str) -> Result<String> {
    let d = validate_domain(domain)?;
    let e = validate_email(email)?;
    // www. вариант если не wildcard
    let www_flag = if !d.starts_with("www.") && !d.starts_with("*.") {
        format!(" -d www.{}", d)
    } else {
        String::new()
    };
    Ok(format!(
        "certbot --nginx --non-interactive --agree-tos -m {:?} -d {:?}{} 2>&1",
        e, d, www_flag
    ))
}

/// Проверить существующий сертификат для домена через openssl.
/// Не использует private key — только публичный сертификат.
pub fn check_cert_cmd(domain: &str) -> Result<String> {
    let d = validate_domain(domain)?;
    Ok(format!(
        r#"echo | openssl s_client -connect {d}:443 -servername {d} 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || echo CERT_CHECK_FAILED"#
    ))
}

/// Проверить certbot renewal dry-run (безопасно, ничего не меняет).
pub const CERTBOT_DRY_RUN_CMD: &str =
    "certbot renew --dry-run 2>&1 | tail -20";

/// Найти SSL сертификат для домена в конфиге Nginx.
pub fn find_ssl_in_config_cmd(config_path: &str) -> Result<String> {
    let p = validate_path(config_path)?;
    Ok(format!(
        r#"grep -E 'ssl_certificate |ssl_certificate_key |listen.*443|listen.*ssl' {:?} 2>/dev/null | head -10 || echo NO_SSL"#,
        p
    ))
}

/// Получить данные сертификата из файла (только публичный cert).
pub fn read_cert_info_cmd(cert_path: &str) -> Result<String> {
    let p = validate_path(cert_path)?;
    Ok(format!(
        "openssl x509 -in {:?} -noout -subject -issuer -dates -fingerprint 2>/dev/null || echo CERT_READ_FAILED",
        p
    ))
}
