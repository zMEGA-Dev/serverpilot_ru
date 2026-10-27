use crate::nginx;
use crate::ssh;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

// ─── Типы ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxInfo {
    pub installed: bool,
    pub version: String,
    pub running: bool,
    pub config_ok: bool,
    pub config_test_output: String,
    pub has_sites_available: bool,
    pub has_sites_enabled: bool,
    pub has_conf_d: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxSite {
    pub name: String,
    pub config_path: String,
    pub enabled: bool,
    pub listen_ports: Vec<String>,
    pub server_names: Vec<String>,
    pub has_ssl: bool,
    pub root: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NginxResult {
    pub success: bool,
    pub output: String,
    pub message: String,
}

// ─── Определение Nginx ───────────────────────────────

#[tauri::command]
pub fn nginx_detect(
    _state: State<AppState>,
    server_id: String,
) -> Result<NginxInfo, String> {
    ensure_connected(&server_id)?;

    let result = ssh::execute_command(&server_id, nginx::DETECT_CMD)
        .map_err(|e| e.to_string())?;

    let output = result.stdout.trim().to_string();
    let lines: Vec<&str> = output.lines().collect();

    // Парсим секции по маркерам
    let mut section = "";
    let mut version = String::new();
    let mut running = false;
    let mut has_sites_available = false;
    let mut has_sites_enabled = false;
    let mut has_conf_d = false;
    let mut config_test_output = String::new();

    for line in &lines {
        match *line {
            "---STATUS---" => { section = "status"; continue; }
            "---STRUCTURE---" => { section = "structure"; continue; }
            "---CONFTEST---" => { section = "conftest"; continue; }
            _ => {}
        }
        match section {
            "" => {
                // Первая секция — версия
                if line.contains("nginx version:") || line.contains("nginx/") {
                    version = line.replace("nginx version: ", "").trim().to_string();
                }
            }
            "status" => {
                running = line.trim() == "active" || line.contains("running");
            }
            "structure" => {
                if *line == "has_sites_available" { has_sites_available = true; }
                if *line == "has_sites_enabled" { has_sites_enabled = true; }
                if *line == "has_conf_d" { has_conf_d = true; }
            }
            "conftest" => {
                config_test_output.push_str(line);
                config_test_output.push('\n');
            }
            _ => {}
        }
    }

    let installed = !version.is_empty() || result.exit_code == 0;
    let config_ok = config_test_output.contains("syntax is ok") || config_test_output.contains("test is successful");

    Ok(NginxInfo {
        installed,
        version,
        running,
        config_ok,
        config_test_output: config_test_output.trim().to_string(),
        has_sites_available,
        has_sites_enabled,
        has_conf_d,
    })
}

// ─── Список сайтов ───────────────────────────────────

#[tauri::command]
pub fn nginx_list_sites(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<NginxSite>, String> {
    ensure_connected(&server_id)?;

    // Пробуем sites-available сначала
    let sa_result = ssh::execute_command(&server_id, nginx::LIST_SITES_AVAILABLE_CMD)
        .map_err(|e| e.to_string())?;

    let mut sites: Vec<NginxSite> = Vec::new();

    if !sa_result.stdout.contains("NO_DIR") && !sa_result.stdout.trim().is_empty() {
        // Парсим сайты из sites-available
        for name in sa_result.stdout.lines() {
            let name = name.trim();
            if name.is_empty() || name == "." || name == ".." { continue; }

            let config_path = format!("/etc/nginx/sites-available/{}", name);

            // Проверяем включён ли
            let enabled = if let Ok(cmd) = nginx::check_enabled_cmd(name) {
                let r = ssh::execute_command(&server_id, &cmd).unwrap_or_default_result();
                r.stdout.contains("ENABLED")
            } else { false };

            // Читаем конфиг для парсинга портов/доменов
            let site_info = parse_site_config(&server_id, &config_path, name, &config_path, enabled);
            sites.push(site_info);
        }
    } else {
        // Fallback: conf.d
        let cd_result = ssh::execute_command(&server_id, nginx::LIST_CONF_D_CMD)
            .map_err(|e| e.to_string())?;

        if !cd_result.stdout.contains("NO_DIR") {
            for name in cd_result.stdout.lines() {
                let name = name.trim();
                if name.is_empty() { continue; }
                let config_path = format!("/etc/nginx/conf.d/{}", name);
                let site_info = parse_site_config(&server_id, &config_path, name, &config_path, true);
                sites.push(site_info);
            }
        }
    }

    Ok(sites)
}

fn parse_site_config(server_id: &str, config_path: &str, name: &str, path: &str, enabled: bool) -> NginxSite {
    let mut listen_ports = Vec::new();
    let mut server_names = Vec::new();
    let mut has_ssl = false;
    let mut root = String::new();

    if let Ok(cmd) = nginx::read_config_cmd(config_path) {
        if let Ok(r) = ssh::execute_command(server_id, &cmd) {
            for line in r.stdout.lines() {
                let line = line.trim();
                if line.starts_with("listen ") {
                    let port = line.replace("listen ", "").replace(';', "").trim().to_string();
                    listen_ports.push(port.clone());
                    if port.contains("ssl") || port == "443" { has_ssl = true; }
                }
                if line.starts_with("server_name ") {
                    let names = line.replace("server_name ", "").replace(';', "");
                    for n in names.split_whitespace() {
                        if !n.is_empty() && n != "_" {
                            server_names.push(n.to_string());
                        }
                    }
                }
                if line.starts_with("root ") {
                    root = line.replace("root ", "").replace(';', "").trim().to_string();
                }
                if line.contains("ssl_certificate") { has_ssl = true; }
            }
        }
    }

    NginxSite {
        name: name.to_string(),
        config_path: path.to_string(),
        enabled,
        listen_ports,
        server_names,
        has_ssl,
        root,
    }
}

// ─── Чтение конфига ───────────────────────────────────

#[tauri::command]
pub fn nginx_read_config(
    _state: State<AppState>,
    server_id: String,
    config_path: String,
) -> Result<String, String> {
    ensure_connected(&server_id)?;
    let cmd = nginx::read_config_cmd(&config_path).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    if result.exit_code != 0 {
        return Err(format!("Не удалось прочитать файл: {}", result.stdout.trim()));
    }
    Ok(result.stdout)
}

// ─── Сохранение конфига ───────────────────────────────

#[tauri::command]
pub fn nginx_write_config(
    _state: State<AppState>,
    server_id: String,
    config_path: String,
    content: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    log::info!("[NGINX] write_config path={}", config_path);

    // 1. Backup
    let backup_cmd = nginx::backup_config_cmd(&config_path).map_err(|e| e.to_string())?;
    let backup_result = ssh::execute_command(&server_id, &backup_cmd).map_err(|e| e.to_string())?;
    if !backup_result.stdout.contains("BACKUP_OK") {
        log::warn!("[NGINX] backup failed: {}", backup_result.stdout);
    }

    // 2. Запись
    let write_cmd = nginx::write_config_cmd(&config_path, &content).map_err(|e| e.to_string())?;
    let write_result = ssh::execute_command(&server_id, &write_cmd).map_err(|e| e.to_string())?;
    if !write_result.stdout.contains("WRITE_OK") && write_result.exit_code != 0 {
        return Ok(NginxResult {
            success: false,
            output: write_result.stdout.clone(),
            message: format!("Не удалось записать файл. Возможно нет прав: {}", write_result.stdout.trim()),
        });
    }

    // 3. nginx -t
    let test_result = ssh::execute_command(&server_id, nginx::TEST_CONFIG_CMD).map_err(|e| e.to_string())?;
    let test_output = format!("{}{}", test_result.stdout, test_result.stderr);
    let config_ok = test_output.contains("syntax is ok") || test_output.contains("test is successful");

    if !config_ok {
        return Ok(NginxResult {
            success: false,
            output: test_output.trim().to_string(),
            message: "Конфигурация содержит ошибку. Nginx не перезагружен. Используйте «Восстановить резервную копию».".to_string(),
        });
    }

    Ok(NginxResult {
        success: true,
        output: test_output.trim().to_string(),
        message: "Конфигурация сохранена и прошла проверку nginx -t".to_string(),
    })
}

// ─── Тест конфига ─────────────────────────────────────

#[tauri::command]
pub fn nginx_test_config(
    _state: State<AppState>,
    server_id: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    let result = ssh::execute_command(&server_id, nginx::TEST_CONFIG_CMD).map_err(|e| e.to_string())?;
    let output = format!("{}{}", result.stdout, result.stderr);
    let ok = output.contains("syntax is ok") || output.contains("test is successful");
    Ok(NginxResult {
        success: ok,
        output: output.trim().to_string(),
        message: if ok { "Конфигурация корректна".to_string() } else { "Найдены ошибки в конфигурации".to_string() },
    })
}

// ─── Reload ───────────────────────────────────────────

#[tauri::command]
pub fn nginx_reload(
    _state: State<AppState>,
    server_id: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    log::info!("[NGINX] reload");

    // Сначала nginx -t
    let test = ssh::execute_command(&server_id, nginx::TEST_CONFIG_CMD).map_err(|e| e.to_string())?;
    let test_output = format!("{}{}", test.stdout, test.stderr);
    let config_ok = test_output.contains("syntax is ok") || test_output.contains("test is successful");

    if !config_ok {
        return Ok(NginxResult {
            success: false,
            output: test_output.trim().to_string(),
            message: "Конфигурация содержит ошибку. Nginx не перезагружен.".to_string(),
        });
    }

    // Reload
    let reload = ssh::execute_command(&server_id, nginx::RELOAD_CMD).map_err(|e| e.to_string())?;
    let reload_output = format!("{}{}", reload.stdout, reload.stderr).trim().to_string();
    let success = reload.exit_code == 0;

    Ok(NginxResult {
        success,
        output: reload_output.clone(),
        message: if success { "Nginx успешно перезагружен".to_string() }
                 else { format!("Ошибка перезагрузки: {}", reload_output) },
    })
}

// ─── Enable / Disable ────────────────────────────────

#[tauri::command]
pub fn nginx_enable_site(
    _state: State<AppState>,
    server_id: String,
    site_name: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    let cmd = nginx::enable_site_cmd(&site_name).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let ok = result.stdout.contains("ENABLE_OK");
    Ok(NginxResult {
        success: ok,
        output: result.stdout.trim().to_string(),
        message: if ok { format!("Сайт {} включён", site_name) }
                 else { format!("Не удалось включить сайт: {}", result.stdout.trim()) },
    })
}

#[tauri::command]
pub fn nginx_disable_site(
    _state: State<AppState>,
    server_id: String,
    site_name: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    let cmd = nginx::disable_site_cmd(&site_name).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let ok = result.stdout.contains("DISABLE_OK");
    Ok(NginxResult {
        success: ok,
        output: result.stdout.trim().to_string(),
        message: if ok { format!("Сайт {} отключён", site_name) }
                 else { format!("Не удалось отключить сайт: {}", result.stdout.trim()) },
    })
}

// ─── Создать сайт ────────────────────────────────────

#[tauri::command]
pub fn nginx_create_site(
    _state: State<AppState>,
    server_id: String,
    domain: String,
    port: u16,
    root_dir: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    log::info!("[NGINX] create_site domain={} port={}", domain, port);

    let content = nginx::generate_server_block(&domain, port, &root_dir)
        .map_err(|e| e.to_string())?;

    let cmd = nginx::create_site_cmd(&domain, &content).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let ok = result.stdout.contains("WRITE_OK");

    Ok(NginxResult {
        success: ok,
        output: if ok { content } else { result.stdout.trim().to_string() },
        message: if ok { format!("Сайт {} создан в /etc/nginx/sites-available/{}", domain, domain) }
                 else { format!("Не удалось создать сайт: {}", result.stdout.trim()) },
    })
}

// ─── Удалить конфиг ───────────────────────────────────

#[tauri::command]
pub fn nginx_delete_config(
    _state: State<AppState>,
    server_id: String,
    config_path: String,
    site_name: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    log::info!("[NGINX] delete_config path={}", config_path);

    // Сначала disable
    if let Ok(cmd) = nginx::disable_site_cmd(&site_name) {
        let _ = ssh::execute_command(&server_id, &cmd);
    }

    let cmd = nginx::delete_config_cmd(&config_path).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let ok = result.stdout.contains("DELETE_OK");

    Ok(NginxResult {
        success: ok,
        output: result.stdout.trim().to_string(),
        message: if ok { format!("Конфигурация {} удалена (файлы сайта не затронуты)", config_path) }
                 else { format!("Не удалось удалить: {}", result.stdout.trim()) },
    })
}

// ─── Восстановить backup ─────────────────────────────

#[tauri::command]
pub fn nginx_restore_backup(
    _state: State<AppState>,
    server_id: String,
    config_path: String,
) -> Result<NginxResult, String> {
    ensure_connected(&server_id)?;
    let cmd = nginx::restore_backup_cmd(&config_path).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let ok = result.stdout.contains("RESTORE_OK");
    Ok(NginxResult {
        success: ok,
        output: result.stdout.trim().to_string(),
        message: if ok { "Резервная копия восстановлена".to_string() }
                 else { format!("Не удалось восстановить: {}", result.stdout.trim()) },
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

// Трейт для default CommandResult
trait DefaultResult {
    fn unwrap_or_default_result(self) -> crate::ssh::CommandResult;
}
impl DefaultResult for anyhow::Result<crate::ssh::CommandResult> {
    fn unwrap_or_default_result(self) -> crate::ssh::CommandResult {
        self.unwrap_or(crate::ssh::CommandResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: -1,
            duration_ms: 0,
        })
    }
}
