use crate::security::{self, AuditResult, CheckStatus, SecurityCheck};
use crate::ssh;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn run_security_audit(
    _state: State<AppState>,
    server_id: String,
) -> Result<AuditResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения к серверу".to_string());
    }

    log::info!("[SECURITY] starting audit for server={}", server_id);
    let mut checks: Vec<SecurityCheck> = Vec::new();

    // ─── 1. SSH конфигурация ─────────────────────────
    let ssh_output = ssh::execute_command(&server_id, security::SSH_CONFIG_CMD)
        .map(|r| r.stdout)
        .unwrap_or_default();

    if ssh_output.contains("SSH_CONFIG_NOT_FOUND") || ssh_output.trim().is_empty() {
        checks.push(SecurityCheck {
            id: "ssh_config".to_string(),
            category: "SSH".to_string(),
            title: "Конфигурация SSH".to_string(),
            status: CheckStatus::Unknown,
            current_value: "Файл sshd_config не найден".to_string(),
            description: "Не удалось прочитать конфигурацию SSH-сервера.".to_string(),
            recommendation: "Проверьте наличие файла /etc/ssh/sshd_config.".to_string(),
        });
    } else {
        let cfg = security::parse_ssh_config(&ssh_output);

        // Root login
        let (root_status, root_desc) = match cfg.permit_root_login.as_str() {
            "yes" => (CheckStatus::Critical,
                "Прямой вход под root разрешён. Это серьёзная уязвимость."),
            "without-password" | "prohibit-password" => (CheckStatus::Warning,
                "Вход под root разрешён только по ключу. Рекомендуется отключить полностью."),
            "forced-commands-only" => (CheckStatus::Warning,
                "Root доступен только для заданных команд."),
            "no" => (CheckStatus::Pass, "Вход под root отключён."),
            "unknown" => (CheckStatus::Unknown, "Параметр PermitRootLogin не задан явно (используется значение по умолчанию)."),
            v => (CheckStatus::Info, v),
        };
        checks.push(SecurityCheck {
            id: "ssh_root_login".to_string(),
            category: "SSH".to_string(),
            title: "Root login по SSH".to_string(),
            status: root_status,
            current_value: format!("PermitRootLogin = {}", cfg.permit_root_login),
            description: root_desc.to_string(),
            recommendation: "Установите: PermitRootLogin no\nИспользуйте отдельного пользователя с sudo.".to_string(),
        });

        // Password authentication
        let (pass_status, pass_desc) = match cfg.password_authentication.as_str() {
            "yes" => (CheckStatus::Warning,
                "Вход по паролю разрешён. Сервер подвержен brute-force атакам."),
            "no" => (CheckStatus::Pass, "Вход по паролю отключён. Используются только ключи."),
            "unknown" => (CheckStatus::Unknown, "Параметр PasswordAuthentication не задан явно."),
            _ => (CheckStatus::Info, cfg.password_authentication.as_str()),
        };
        checks.push(SecurityCheck {
            id: "ssh_password_auth".to_string(),
            category: "SSH".to_string(),
            title: "Аутентификация по паролю SSH".to_string(),
            status: pass_status,
            current_value: format!("PasswordAuthentication = {}", cfg.password_authentication),
            description: pass_desc.to_string(),
            recommendation: "Установите: PasswordAuthentication no\nИспользуйте SSH-ключи для аутентификации.".to_string(),
        });

        // SSH port
        let port_num = cfg.port.parse::<u16>().unwrap_or(22);
        let (port_status, port_desc) = if port_num == 22 {
            (CheckStatus::Warning,
             "Стандартный порт 22 используется. Боты активно сканируют его.")
        } else {
            (CheckStatus::Pass,
             "Нестандартный порт снижает количество автоматических атак.")
        };
        checks.push(SecurityCheck {
            id: "ssh_port".to_string(),
            category: "SSH".to_string(),
            title: "Порт SSH".to_string(),
            status: port_status,
            current_value: format!("Port = {}", cfg.port),
            description: port_desc.to_string(),
            recommendation: if port_num == 22 {
                "Рекомендуется изменить порт на нестандартный (например, 2222, 8022).\nUstanite: Port 2222".to_string()
            } else {
                "Нестандартный порт уже используется.".to_string()
            },
        });
    }

    // ─── 2. Firewall ─────────────────────────────────
    let fw_output = ssh::execute_command(&server_id, security::FIREWALL_CMD)
        .map(|r| r.stdout)
        .unwrap_or_default();

    let fw_check = parse_firewall_check(&fw_output);
    checks.push(fw_check);

    // ─── 3. Открытые порты ───────────────────────────
    let ports_output = ssh::execute_command(&server_id, security::OPEN_PORTS_CMD)
        .map(|r| r.stdout)
        .unwrap_or_default();

    let ports_check = parse_open_ports(&ports_output);
    checks.push(ports_check);

    // ─── 4. Неудачные попытки входа ──────────────────
    let failed_output = ssh::execute_command(&server_id, security::FAILED_LOGINS_CMD)
        .map(|r| r.stdout.trim().to_string())
        .unwrap_or_default();

    let failed_count = failed_output
        .lines()
        .find(|l| !l.trim().is_empty() && l.trim() != "UNKNOWN")
        .and_then(|l| l.trim().parse::<u64>().ok());

    let (failed_status, failed_val, failed_desc) = match failed_count {
        None => (CheckStatus::Unknown,
            "Не удалось получить данные".to_string(),
            "journalctl, auth.log и lastb недоступны или нет прав."),
        Some(0) => (CheckStatus::Pass,
            "0 неудачных попыток за 48 часов".to_string(),
            "Нет зафиксированных попыток несанкционированного входа."),
        Some(n) if n < 50 => (CheckStatus::Info,
            format!("{} неудачных попыток за 48 часов", n),
            "Небольшое количество неудачных попыток — норма для публичных серверов."),
        Some(n) if n < 500 => (CheckStatus::Warning,
            format!("{} неудачных попыток за 48 часов", n),
            "Заметная активность brute-force. Рекомендуется настроить fail2ban."),
        Some(n) => (CheckStatus::Critical,
            format!("{} неудачных попыток за 48 часов", n),
            "Высокая активность атак. Немедленно настройте fail2ban или поменяйте порт SSH."),
    };
    checks.push(SecurityCheck {
        id: "failed_logins".to_string(),
        category: "Аутентификация".to_string(),
        title: "Неудачные попытки входа".to_string(),
        status: failed_status,
        current_value: failed_val,
        description: failed_desc.to_string(),
        recommendation: "Установите fail2ban для автоматической блокировки атак:\napt install fail2ban".to_string(),
    });

    // ─── Подсчёт score ───────────────────────────────
    let score = security::calculate_score(&checks);
    let pass_count    = checks.iter().filter(|c| c.status == CheckStatus::Pass).count() as u32;
    let warning_count = checks.iter().filter(|c| c.status == CheckStatus::Warning).count() as u32;
    let critical_count = checks.iter().filter(|c| c.status == CheckStatus::Critical).count() as u32;
    let unknown_count  = checks.iter().filter(|c| c.status == CheckStatus::Unknown).count() as u32;

    log::info!("[SECURITY] audit done. score={} pass={} warn={} crit={}", score, pass_count, warning_count, critical_count);

    Ok(AuditResult { checks, score, pass_count, warning_count, critical_count, unknown_count })
}

// ─── Вспомогательные функции ─────────────────────────

fn parse_firewall_check(output: &str) -> SecurityCheck {
    let mut ufw_active = false;
    let mut firewalld_active = false;
    let mut nft_rules = 0u32;
    let mut iptables_chains = 0u32;
    let mut section = "";

    for line in output.lines() {
        match line.trim() {
            "---UFW---"       => { section = "ufw"; continue; }
            "---FIREWALLD---" => { section = "firewalld"; continue; }
            "---NFTABLES---"  => { section = "nft"; continue; }
            "---IPTABLES---"  => { section = "ipt"; continue; }
            _ => {}
        }
        match section {
            "ufw" => {
                if line.contains("Status: active") { ufw_active = true; }
            }
            "firewalld" => {
                if line.trim() == "running" { firewalld_active = true; }
            }
            "nft" => {
                if let Ok(n) = line.trim().parse::<u32>() { nft_rules = n; }
            }
            "ipt" => {
                if let Ok(n) = line.trim().parse::<u32>() { iptables_chains = n; }
            }
            _ => {}
        }
    }

    let has_firewall = ufw_active || firewalld_active || nft_rules > 2 || iptables_chains > 3;

    let (status, current, description) = if ufw_active {
        (CheckStatus::Pass, "UFW активен".to_string(), "UFW работает и защищает сервер.")
    } else if firewalld_active {
        (CheckStatus::Pass, "firewalld активен".to_string(), "firewalld работает и защищает сервер.")
    } else if nft_rules > 2 {
        (CheckStatus::Pass, format!("nftables: {} правил", nft_rules), "nftables настроен.")
    } else if iptables_chains > 3 {
        (CheckStatus::Info, format!("iptables: {} цепочек", iptables_chains), "iptables обнаружен, но проверьте правила.")
    } else if has_firewall {
        (CheckStatus::Warning, "Firewall обнаружен, статус неизвестен".to_string(), "Firewall установлен, но не подтверждено что активен.")
    } else {
        (CheckStatus::Critical, "Firewall не обнаружен или неактивен".to_string(),
         "Сервер доступен без ограничений. Все порты открыты.")
    };

    SecurityCheck {
        id: "firewall".to_string(),
        category: "Сеть".to_string(),
        title: "Firewall".to_string(),
        status,
        current_value: current,
        description: description.to_string(),
        recommendation: "Включите UFW:\napt install ufw && ufw enable\nufw allow 22\nufw allow 80\nufw allow 443".to_string(),
    }
}

fn parse_open_ports(output: &str) -> SecurityCheck {
    if output.contains("NO_SS_NETSTAT") || output.trim().is_empty() {
        return SecurityCheck {
            id: "open_ports".to_string(),
            category: "Сеть".to_string(),
            title: "Открытые порты".to_string(),
            status: CheckStatus::Unknown,
            current_value: "ss и netstat недоступны".to_string(),
            description: "Не удалось получить список прослушиваемых портов.".to_string(),
            recommendation: "Установите: apt install iproute2 net-tools".to_string(),
        };
    }

    // Собираем уникальные порты
    let mut ports: Vec<String> = Vec::new();
    let mut suspicious: Vec<String> = Vec::new();

    // Подозрительные порты (не стандартные сервисы)
    let known_safe: std::collections::HashSet<u16> = [
        22, 80, 443, 25, 587, 465, 110, 995, 143, 993,
        53, 3306, 5432, 6379, 27017, 8080, 8443, 3000,
    ].iter().cloned().collect();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        // Извлекаем порт из строки ss/netstat
        // Формат: "tcp LISTEN 0 128 0.0.0.0:22 ..."
        let port_str = line.split_whitespace()
            .find(|p| p.contains(':') && !p.contains("->"))
            .and_then(|s| s.rsplit(':').next())
            .and_then(|p| p.parse::<u16>().ok());

        if let Some(port) = port_str {
            let entry = format!(":{}", port);
            if !ports.contains(&entry) {
                ports.push(entry);
                if port > 1024 && !known_safe.contains(&port) && port < 49000 {
                    suspicious.push(port.to_string());
                }
            }
        }
    }

    let port_count = ports.len();
    let suspicious_count = suspicious.len();

    let (status, current) = if port_count == 0 {
        (CheckStatus::Unknown, "Порты не обнаружены".to_string())
    } else if suspicious_count > 5 {
        (CheckStatus::Warning,
         format!("{} открытых портов, {} нестандартных: {}", port_count, suspicious_count, suspicious.join(", ")))
    } else {
        (CheckStatus::Info,
         format!("{} открытых портов: {}", port_count, ports.join(", ")))
    };

    SecurityCheck {
        id: "open_ports".to_string(),
        category: "Сеть".to_string(),
        title: "Открытые порты".to_string(),
        status,
        current_value: current,
        description: format!(
            "Обнаружено {} прослушиваемых портов.{}",
            port_count,
            if suspicious_count > 0 { format!(" Нестандартных: {}.", suspicious_count) } else { String::new() }
        ),
        recommendation: "Закройте все ненужные порты с помощью firewall.\nПроверьте каждый нестандартный порт.".to_string(),
    }
}
