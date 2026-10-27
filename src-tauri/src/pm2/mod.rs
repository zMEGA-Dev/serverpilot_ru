use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pm2App {
    pub id: u32,
    pub name: String,
    pub pid: u32,
    pub status: String,
    pub cpu: f64,
    pub memory_mb: f64,
    pub restarts: u32,
    pub uptime_ms: u64,
    pub uptime_str: String,
    pub mode: String,
    pub instances: u32,
    pub node_version: String,
    pub script: String,
    pub cwd: String,
    pub args: String,
    pub pm_log_path: String,
    pub pm_err_log_path: String,
    pub ecosystem_path: String,
    pub created_at: String,
    pub namespace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Pm2Info {
    pub installed: bool,
    pub version: String,
    pub apps: Vec<Pm2App>,
    pub error: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Pm2ActionResult {
    pub success: bool,
    pub message: String,
    pub raw_output: String,
}

// ─────────────────────────────────────────────────────
// Ключи environment-переменных которые нужно скрывать
// ─────────────────────────────────────────────────────

const SECRET_KEYS: &[&str] = &[
    "KEY", "TOKEN", "SECRET", "PASSWORD", "PASS", "PASSWD",
    "PRIVATE", "CREDENTIAL", "AUTH", "API_KEY", "APIKEY",
    "ACCESS_KEY", "ACCESS_TOKEN", "CLIENT_SECRET", "DB_PASS",
    "MYSQL_PASSWORD", "POSTGRES_PASSWORD", "REDIS_PASSWORD",
    "JWT_SECRET", "SESSION_SECRET", "ENCRYPTION_KEY",
];

pub fn is_secret_key(key: &str) -> bool {
    let upper = key.to_uppercase();
    SECRET_KEYS.iter().any(|s| upper.contains(s))
}

/// Фильтровать environment object — заменять секреты на "***"
#[allow(dead_code)]
pub fn filter_env(env: &Value) -> Value {
    match env {
        Value::Object(map) => {
            let mut filtered = serde_json::Map::new();
            for (k, v) in map {
                if is_secret_key(k) {
                    filtered.insert(k.clone(), Value::String("***".to_string()));
                } else {
                    filtered.insert(k.clone(), v.clone());
                }
            }
            Value::Object(filtered)
        }
        other => other.clone(),
    }
}

// ─────────────────────────────────────────────────────
// Обнаружение PM2
// ─────────────────────────────────────────────────────

/// Команда для определения версии PM2.
/// Пробуем несколько вариантов: pm2, ~/.npm-global/bin/pm2, /usr/local/bin/pm2
pub const DETECT_COMMAND: &str =
    "command -v pm2 >/dev/null 2>&1 && pm2 --version 2>/dev/null \
     || ~/.npm-global/bin/pm2 --version 2>/dev/null \
     || /usr/local/bin/pm2 --version 2>/dev/null \
     || echo NOT_FOUND";

/// Команда получения полного списка приложений в JSON.
pub const LIST_COMMAND: &str =
    "pm2 jlist 2>/dev/null || echo '[]'";

/// Команда получения логов приложения (последние N строк).
pub fn logs_command(app_name: &str, lines: u32) -> String {
    // Имя приложения — только алфавитно-цифровые символы, дефис, нижнее подчёркивание, точка
    let safe_name = sanitize_app_name(app_name);
    format!(
        "pm2 logs {} --lines {} --nostream --raw 2>&1 | tail -n {}",
        safe_name, lines, lines
    )
}

/// Безопасная команда PM2 action.
/// name проходит валидацию — инъекция невозможна.
pub fn action_command(action: &str, app_name: &str) -> Result<String> {
    let safe_name = sanitize_app_name(app_name);
    let cmd = match action {
        "restart" => format!("pm2 restart {} 2>&1", safe_name),
        "reload"  => format!("pm2 reload {}  2>&1", safe_name),
        "stop"    => format!("pm2 stop {}   2>&1", safe_name),
        "start"   => format!("pm2 start {}  2>&1", safe_name),
        "delete"  => format!("pm2 delete {} 2>&1", safe_name),
        _ => return Err(anyhow::anyhow!("Неизвестное действие PM2: {}", action)),
    };
    Ok(cmd)
}

/// Команда запуска нового приложения.
pub fn start_new_command(
    name: &str,
    script: &str,
    cwd: &str,
    interpreter: &str,
    args: &str,
) -> Result<String> {
    // Валидируем имя — только безопасные символы
    let safe_name = sanitize_app_name(name);
    if safe_name.is_empty() {
        return Err(anyhow::anyhow!("Некорректное имя приложения"));
    }

    // Путь к скрипту — не должен содержать ; | & < > ` $ ( )
    if contains_shell_special(script) || contains_shell_special(cwd) {
        return Err(anyhow::anyhow!("Путь содержит недопустимые символы"));
    }

    let interp_part = if !interpreter.is_empty() && interpreter != "node" {
        format!("--interpreter={} ", sanitize_app_name(interpreter))
    } else {
        String::new()
    };

    let args_part = if !args.is_empty() {
        format!(" -- {}", sanitize_args(args))
    } else {
        String::new()
    };

    let cwd_part = if !cwd.is_empty() {
        // Используем {:?} (Debug форматирование строк в Rust) — добавляет кавычки
        // и экранирует все спецсимволы включая \, ", \n и т.д.
        format!(" --cwd {:?}", cwd)
    } else {
        String::new()
    };

    Ok(format!(
        "pm2 start {:?} {}--name {} {}{}2>&1",
        script, interp_part, safe_name, cwd_part, args_part
    ))
}

// ─────────────────────────────────────────────────────
// Валидация / санитизация
// ─────────────────────────────────────────────────────

/// Оставить только безопасные символы для имени PM2 приложения.
fn sanitize_app_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .take(64)
        .collect()
}

/// Оставить только безопасные символы для аргументов.
fn sanitize_args(args: &str) -> String {
    args.chars()
        .filter(|c| !matches!(c, ';' | '|' | '&' | '<' | '>' | '`' | '$' | '(' | ')' | '\0'))
        .take(256)
        .collect()
}

fn contains_shell_special(s: &str) -> bool {
    s.contains(';') || s.contains('|') || s.contains('&')
        || s.contains('<') || s.contains('>')
        || s.contains('`') || s.contains('$')
        || s.contains('(') || s.contains(')')
        || s.contains('\0')
}

// ─────────────────────────────────────────────────────
// Парсинг вывода pm2 jlist
// ─────────────────────────────────────────────────────

fn ms_to_uptime(ms: u64) -> String {
    if ms == 0 { return "—".to_string(); }
    let secs = ms / 1000;
    let mins = secs / 60;
    let hours = mins / 60;
    let days = hours / 24;
    if days > 0 { return format!("{}д {}ч", days, hours % 24); }
    if hours > 0 { return format!("{}ч {}м", hours, mins % 60); }
    if mins > 0 { return format!("{}м", mins); }
    format!("{}с", secs)
}

pub fn parse_jlist(json_str: &str) -> Vec<Pm2App> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() || trimmed == "NOT_FOUND" { return vec![]; }

    let arr: Vec<Value> = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    arr.into_iter()
        .filter_map(|item| parse_single(&item))
        .collect()
}

fn parse_single(item: &Value) -> Option<Pm2App> {
    let pm2_env = item.get("pm2_env")?;

    let id = item["pm_id"].as_u64().unwrap_or(0) as u32;
    let name = item["name"].as_str().unwrap_or("").to_string();
    let pid = item["pid"].as_u64().unwrap_or(0) as u32;

    let status = pm2_env["status"].as_str().unwrap_or("unknown").to_string();

    let monit = item.get("monit").unwrap_or(&Value::Null);
    let cpu = monit["cpu"].as_f64().unwrap_or(0.0);
    let memory = monit["memory"].as_u64().unwrap_or(0);
    let memory_mb = memory as f64 / 1_048_576.0;

    let restarts = pm2_env["restart_time"].as_u64().unwrap_or(0) as u32;

    // pm_uptime хранит unix timestamp (ms) старта, вычисляем uptime
    let pm_uptime = pm2_env["pm_uptime"].as_u64().unwrap_or(0);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let uptime_ms = if pm_uptime > 0 && now_ms > pm_uptime { now_ms - pm_uptime } else { 0 };
    let uptime_str = ms_to_uptime(uptime_ms);

    let exec_mode = pm2_env["exec_mode"].as_str().unwrap_or("fork").to_string();
    let instances = pm2_env["instances"].as_u64().unwrap_or(1) as u32;

    let node_version = pm2_env["node_version"].as_str()
        .or_else(|| pm2_env["versioning"].get("comment").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();

    let script = pm2_env["pm_exec_path"].as_str()
        .or_else(|| pm2_env["script"].as_str())
        .unwrap_or("").to_string();

    let cwd = pm2_env["pm_cwd"].as_str()
        .or_else(|| pm2_env["cwd"].as_str())
        .unwrap_or("").to_string();

    let args_raw = &pm2_env["args"];
    let args = if args_raw.is_array() {
        args_raw.as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" "))
            .unwrap_or_default()
    } else {
        args_raw.as_str().unwrap_or("").to_string()
    };

    let pm_log_path = pm2_env["pm_out_log_path"].as_str().unwrap_or("").to_string();
    let pm_err_log_path = pm2_env["pm_err_log_path"].as_str().unwrap_or("").to_string();

    // Ecosystem config
    let ecosystem_path = pm2_env["ecosystem"].as_str()
        .or_else(|| pm2_env["config_file"].as_str())
        .unwrap_or("").to_string();

    let created_at = pm2_env["created_at"].as_u64().unwrap_or(0);
    let created_str = if created_at > 0 {
        chrono::DateTime::from_timestamp_millis(created_at as i64)
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default()
    } else { String::new() };

    let namespace = pm2_env["namespace"].as_str().unwrap_or("default").to_string();

    Some(Pm2App {
        id, name, pid, status,
        cpu, memory_mb, restarts,
        uptime_ms, uptime_str,
        mode: exec_mode, instances,
        node_version, script, cwd, args,
        pm_log_path, pm_err_log_path,
        ecosystem_path,
        created_at: created_str,
        namespace,
    })
}

/// Получить env переменные приложения (с фильтрацией секретов).
pub fn parse_env(item: &Value) -> Vec<(String, String)> {
    let env = match item.get("pm2_env").and_then(|e| e.get("env")) {
        Some(v) => v,
        None => return vec![],
    };

    match env {
        Value::Object(map) => {
            let mut result = Vec::new();
            for (k, v) in map {
                // Пропускаем внутренние переменные PM2
                if k.starts_with("pm_") || k.starts_with("PM2_") { continue; }
                let val = if is_secret_key(k) {
                    "***".to_string()
                } else {
                    v.as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| v.to_string())
                };
                result.push((k.clone(), val));
            }
            result.sort_by(|a, b| a.0.cmp(&b.0));
            result.truncate(50); // Не показываем больше 50 переменных
            result
        }
        _ => vec![],
    }
}
