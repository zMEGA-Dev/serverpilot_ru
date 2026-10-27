use serde::{Deserialize, Serialize};

// ─── Типы ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Warning,
    Critical,
    Info,
    Unknown, // не удалось проверить
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityCheck {
    pub id: String,
    pub category: String,
    pub title: String,
    pub status: CheckStatus,
    pub current_value: String,
    pub description: String,
    pub recommendation: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditResult {
    pub checks: Vec<SecurityCheck>,
    pub score: u32,
    pub pass_count: u32,
    pub warning_count: u32,
    pub critical_count: u32,
    pub unknown_count: u32,
}

// ─── Все команды — только чтение (read-only) ─────────

/// SSH: читаем sshd_config — только cat, никаких изменений.
pub const SSH_CONFIG_CMD: &str =
    "cat /etc/ssh/sshd_config 2>/dev/null || cat /etc/sshd_config 2>/dev/null || echo SSH_CONFIG_NOT_FOUND";

/// SSH: текущий активный порт (из запущенного процесса, не конфига).
#[allow(dead_code)]
pub const SSH_ACTIVE_PORT_CMD: &str =
    "ss -tlnp 2>/dev/null | grep sshd | awk '{print $4}' | sed 's/.*://' | head -3 || netstat -tlnp 2>/dev/null | grep sshd | awk '{print $4}' | sed 's/.*://' | head -3 || echo UNKNOWN";

/// Firewall: определяем что установлено и активно.
pub const FIREWALL_CMD: &str = r#"
echo "---UFW---";
command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -3 || echo "NOT_FOUND";
echo "---FIREWALLD---";
command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null || echo "NOT_FOUND";
echo "---NFTABLES---";
command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | wc -l || echo "NOT_FOUND";
echo "---IPTABLES---";
command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null | grep -c "Chain" || echo "NOT_FOUND"
"#;

/// Открытые порты — только listen, без прав менять.
pub const OPEN_PORTS_CMD: &str = r#"
ss -tlnpu 2>/dev/null | grep LISTEN | awk '{print $1, $4, $5, $6, $7}' | head -50 ||
netstat -tlnpu 2>/dev/null | grep LISTEN | awk '{print $1, $4, $6, $7}' | head -50 ||
echo "NO_SS_NETSTAT"
"#;

/// Неудачные попытки входа — только чтение логов.
pub const FAILED_LOGINS_CMD: &str = r#"
journalctl -q --no-pager -u ssh -u sshd --since "48 hours ago" 2>/dev/null | grep -c "Failed\|Invalid" 2>/dev/null ||
grep -c "Failed password\|Invalid user" /var/log/auth.log 2>/dev/null ||
grep -c "Failed password\|Invalid user" /var/log/secure 2>/dev/null ||
lastb 2>/dev/null | wc -l ||
echo "UNKNOWN"
"#;

// ─── Парсинг SSH конфига ──────────────────────────────

pub struct SshConfig {
    pub permit_root_login: String, // "yes" | "no" | "without-password" | "prohibit-password" | "forced-commands-only"
    pub password_authentication: String, // "yes" | "no"
    pub port: String,
}

pub fn parse_ssh_config(output: &str) -> SshConfig {
    let mut cfg = SshConfig {
        permit_root_login: "unknown".to_string(),
        password_authentication: "unknown".to_string(),
        port: "22".to_string(),
    };

    for line in output.lines() {
        let line = line.trim();
        // Пропускаем комментарии и пустые строки
        if line.starts_with('#') || line.is_empty() { continue; }

        let lower = line.to_lowercase();
        if lower.starts_with("permitrootlogin") {
            let val = line.splitn(2, char::is_whitespace).nth(1).unwrap_or("").trim();
            cfg.permit_root_login = val.to_lowercase();
        }
        if lower.starts_with("passwordauthentication") {
            let val = line.splitn(2, char::is_whitespace).nth(1).unwrap_or("").trim();
            cfg.password_authentication = val.to_lowercase();
        }
        if lower.starts_with("port") && !lower.starts_with("portforwarding") {
            let val = line.splitn(2, char::is_whitespace).nth(1).unwrap_or("22").trim();
            if val.parse::<u16>().is_ok() {
                cfg.port = val.to_string();
            }
        }
    }

    cfg
}

// ─── Подсчёт score ────────────────────────────────────

pub fn calculate_score(checks: &[SecurityCheck]) -> u32 {
    if checks.is_empty() { return 100; }

    let total_weight: u32 = checks.iter().filter(|c| c.status != CheckStatus::Unknown).count() as u32;
    if total_weight == 0 { return 100; }

    let mut deductions: u32 = 0;
    for check in checks {
        match check.status {
            CheckStatus::Critical => deductions += 25,
            CheckStatus::Warning  => deductions += 10,
            CheckStatus::Pass | CheckStatus::Info => {}
            CheckStatus::Unknown  => {} // не штрафуем за неизвестное
        }
    }

    let max_possible = total_weight * 25; // если бы всё было critical
    if max_possible == 0 { return 100; }

    let score = 100_u32.saturating_sub((deductions * 100) / max_possible.max(100));
    score.max(0).min(100)
}
