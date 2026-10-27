use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStats {
    pub server_id: String,
    pub cpu_usage: f64,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub ram_usage_percent: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub disk_usage_percent: f64,
    pub load_avg_1: f64,
    pub load_avg_5: f64,
    pub load_avg_15: f64,
    pub uptime_seconds: u64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
    pub os_name: String,
    pub kernel_version: String,
    pub hostname: String,
    pub timestamp: String,
}

/// Одна команда, которая выводит все метрики как key=value, по одной на строку.
/// Не требует python3, awk, perl — только базовый sh + /proc.
pub const STATS_COMMAND: &str = concat!(
    // CPU: берём idle из /proc/stat, вычисляем usage
    "CPU=$(cat /proc/stat | head -1 | awk '{idle=$5; total=$2+$3+$4+$5+$6+$7+$8; ",
    "printf \"%.1f\", (1 - idle/total) * 100}'); ",
    // RAM из /proc/meminfo
    "RAM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2}'); ",
    "RAM_FREE=$(grep MemAvailable /proc/meminfo | awk '{print $2}'); ",
    "RAM_USED=$((RAM_TOTAL - RAM_FREE)); ",
    // Disk /
    "DISK=$(df -k / | tail -1 | awk '{print $2, $3}'); ",
    "DISK_TOTAL=$(echo $DISK | cut -d' ' -f1); ",
    "DISK_USED=$(echo $DISK | cut -d' ' -f2); ",
    // Load average
    "LOAD=$(cat /proc/loadavg | cut -d' ' -f1-3); ",
    "LOAD1=$(echo $LOAD | cut -d' ' -f1); ",
    "LOAD5=$(echo $LOAD | cut -d' ' -f2); ",
    "LOAD15=$(echo $LOAD | cut -d' ' -f3); ",
    // Uptime
    "UPTIME=$(cat /proc/uptime | cut -d'.' -f1); ",
    // Network: берём первый не-lo интерфейс из /proc/net/dev
    "NET=$(grep -v 'lo\\|Inter\\|face' /proc/net/dev | head -1 | tr -s ' ' | sed 's/^ //'); ",
    "NET_RX=$(echo $NET | cut -d' ' -f2); ",
    "NET_TX=$(echo $NET | cut -d' ' -f10); ",
    // OS
    "OS=$(cat /etc/os-release 2>/dev/null | grep '^PRETTY_NAME' | cut -d= -f2 | tr -d '\"' || echo Linux); ",
    "KERNEL=$(uname -r); ",
    "HOST=$(hostname); ",
    // Вывод
    "echo \"cpu=$CPU\"; ",
    "echo \"ram_total_kb=$RAM_TOTAL\"; ",
    "echo \"ram_used_kb=$RAM_USED\"; ",
    "echo \"disk_total_kb=$DISK_TOTAL\"; ",
    "echo \"disk_used_kb=$DISK_USED\"; ",
    "echo \"load1=$LOAD1\"; ",
    "echo \"load5=$LOAD5\"; ",
    "echo \"load15=$LOAD15\"; ",
    "echo \"uptime=$UPTIME\"; ",
    "echo \"net_rx=$NET_RX\"; ",
    "echo \"net_tx=$NET_TX\"; ",
    "echo \"os=$OS\"; ",
    "echo \"kernel=$KERNEL\"; ",
    "echo \"hostname=$HOST\""
);

/// Парсит вывод key=value в ServerStats.
pub fn parse_stats(server_id: &str, output: &str) -> Result<ServerStats> {
    let mut map = std::collections::HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some(pos) = line.find('=') {
            let key = line[..pos].trim().to_string();
            let val = line[pos + 1..].trim().to_string();
            map.insert(key, val);
        }
    }

    let cpu_usage = map.get("cpu")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);

    let ram_total_kb = map.get("ram_total_kb")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let ram_used_kb = map.get("ram_used_kb")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let ram_total_mb = ram_total_kb / 1024;
    let ram_used_mb = ram_used_kb / 1024;

    let disk_total_kb = map.get("disk_total_kb")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let disk_used_kb = map.get("disk_used_kb")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let disk_total_gb = disk_total_kb as f64 / 1_048_576.0;
    let disk_used_gb = disk_used_kb as f64 / 1_048_576.0;

    let load_avg_1 = map.get("load1").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let load_avg_5 = map.get("load5").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let load_avg_15 = map.get("load15").and_then(|v| v.parse().ok()).unwrap_or(0.0);

    let uptime_seconds = map.get("uptime").and_then(|v| v.parse().ok()).unwrap_or(0);

    let network_rx_bytes = map.get("net_rx").and_then(|v| v.parse().ok()).unwrap_or(0);
    let network_tx_bytes = map.get("net_tx").and_then(|v| v.parse().ok()).unwrap_or(0);

    let os_name = map.get("os").cloned().unwrap_or_else(|| "Linux".to_string());
    let kernel_version = map.get("kernel").cloned().unwrap_or_default();
    let hostname = map.get("hostname").cloned().unwrap_or_default();

    Ok(ServerStats {
        server_id: server_id.to_string(),
        cpu_usage,
        ram_used_mb,
        ram_total_mb,
        ram_usage_percent: if ram_total_mb > 0 {
            (ram_used_mb as f64 / ram_total_mb as f64) * 100.0
        } else {
            0.0
        },
        disk_used_gb,
        disk_total_gb,
        disk_usage_percent: if disk_total_gb > 0.0 {
            (disk_used_gb / disk_total_gb) * 100.0
        } else {
            0.0
        },
        load_avg_1,
        load_avg_5,
        load_avg_15,
        uptime_seconds,
        network_rx_bytes,
        network_tx_bytes,
        os_name,
        kernel_version,
        hostname,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}
