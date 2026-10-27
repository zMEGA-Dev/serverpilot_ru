use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerInfo {
    pub installed: bool,
    pub version: String,
    pub daemon_running: bool,
    pub has_permission: bool,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub short_id: String,
    pub name: String,
    pub image: String,
    pub image_id: String,
    pub status: String,
    pub state: String,
    pub created: String,
    pub started_at: String,
    pub ports: String,
    pub cpu_percent: f64,
    pub mem_mb: f64,
    pub mem_limit_mb: f64,
    pub mem_percent: f64,
    pub command: String,
    pub restart_policy: String,
    pub networks: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainerDetail {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub created: String,
    pub started_at: String,
    pub finished_at: String,
    pub ports: Vec<String>,
    pub mounts: Vec<DockerMount>,
    pub networks: Vec<String>,
    pub restart_policy: String,
    pub command: String,
    pub entrypoint: String,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerMount {
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub mount_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerImage {
    pub id: String,
    pub short_id: String,
    pub repository: String,
    pub tag: String,
    pub created: String,
    pub size_mb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerNetwork {
    pub id: String,
    pub short_id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub subnet: String,
    pub gateway: String,
    pub containers: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerActionResult {
    pub success: bool,
    pub message: String,
    pub output: String,
}

// ─────────────────────────────────────────────────────
// Ключи env которые нужно скрывать
// ─────────────────────────────────────────────────────

const SECRET_KEYS: &[&str] = &[
    "KEY", "TOKEN", "SECRET", "PASSWORD", "PASS", "PASSWD",
    "PRIVATE", "CREDENTIAL", "AUTH", "API_KEY", "APIKEY",
    "ACCESS_KEY", "ACCESS_TOKEN", "CLIENT_SECRET",
    "DB_PASS", "MYSQL_PASSWORD", "POSTGRES_PASSWORD",
    "REDIS_PASSWORD", "JWT_SECRET", "SESSION_SECRET",
    "ENCRYPTION_KEY",
];

pub fn is_secret_key(key: &str) -> bool {
    let upper = key.to_uppercase();
    SECRET_KEYS.iter().any(|s| upper.contains(s))
}

// ─────────────────────────────────────────────────────
// Валидация идентификаторов
// ─────────────────────────────────────────────────────

/// Разрешённые символы для container/image/network/volume ID и имён.
pub fn sanitize_docker_id(input: &str) -> anyhow::Result<String> {
    let s = input.trim();
    if s.is_empty() {
        return Err(anyhow::anyhow!("Идентификатор не может быть пустым"));
    }
    // Только hex, буквы, цифры, дефис, нижнее подчёркивание, точка, слэш, двоеточие
    let clean: String = s.chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
        .take(256)
        .collect();
    if clean.is_empty() {
        return Err(anyhow::anyhow!("Идентификатор содержит недопустимые символы"));
    }
    Ok(clean)
}

// ─────────────────────────────────────────────────────
// Команды обнаружения
// ─────────────────────────────────────────────────────

#[allow(dead_code)]
pub const DETECT_COMMAND: &str =
    "docker --version 2>&1 && docker info --format '{{.ServerVersion}}' 2>&1 || echo DOCKER_ERROR";

// ─────────────────────────────────────────────────────
// Команды для контейнеров
// ─────────────────────────────────────────────────────

/// Список контейнеров в JSON формате.
pub const LIST_CONTAINERS_CMD: &str =
    "docker ps -a --format '{{json .}}' 2>&1";

/// Получить stats для запущенных контейнеров (без stream).
pub const STATS_CONTAINERS_CMD: &str =
    "docker stats --no-stream --format '{{json .}}' 2>&1";

/// Inspect конкретного контейнера.
pub fn inspect_container_cmd(id: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(id)?;
    Ok(format!("docker inspect {} 2>&1", safe))
}

/// Логи контейнера.
pub fn container_logs_cmd(id: &str, lines: u32) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(id)?;
    let n = lines.min(1000).max(10);
    Ok(format!("docker logs --tail {} {} 2>&1", n, safe))
}

/// Действие над контейнером (start/stop/restart/pause/unpause/rm).
pub fn container_action_cmd(action: &str, id: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(id)?;
    let docker_action = match action {
        "start"   => "start",
        "stop"    => "stop",
        "restart" => "restart",
        "pause"   => "pause",
        "unpause" => "unpause",
        "remove"  => "rm -f",
        _ => return Err(anyhow::anyhow!("Неизвестное действие: {}", action)),
    };
    Ok(format!("docker {} {} 2>&1", docker_action, safe))
}

// ─────────────────────────────────────────────────────
// Команды для образов
// ─────────────────────────────────────────────────────

pub const LIST_IMAGES_CMD: &str =
    "docker images --format '{{json .}}' 2>&1";

pub fn pull_image_cmd(image: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(image)?;
    Ok(format!("docker pull {} 2>&1", safe))
}

pub fn remove_image_cmd(id: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(id)?;
    Ok(format!("docker rmi {} 2>&1", safe))
}

#[allow(dead_code)]
pub fn inspect_image_cmd(id: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(id)?;
    Ok(format!("docker inspect {} 2>&1", safe))
}

// ─────────────────────────────────────────────────────
// Команды для volumes
// ─────────────────────────────────────────────────────

pub const LIST_VOLUMES_CMD: &str =
    "docker volume ls --format '{{json .}}' 2>&1";

#[allow(dead_code)]
pub fn inspect_volume_cmd(name: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(name)?;
    Ok(format!("docker volume inspect {} 2>&1", safe))
}

pub fn remove_volume_cmd(name: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(name)?;
    Ok(format!("docker volume rm {} 2>&1", safe))
}

// ─────────────────────────────────────────────────────
// Команды для networks
// ─────────────────────────────────────────────────────

pub const LIST_NETWORKS_CMD: &str =
    "docker network ls --format '{{json .}}' 2>&1";

pub fn inspect_network_cmd(id: &str) -> anyhow::Result<String> {
    let safe = sanitize_docker_id(id)?;
    Ok(format!("docker network inspect {} 2>&1", safe))
}

// ─────────────────────────────────────────────────────
// Парсинг
// ─────────────────────────────────────────────────────

pub fn parse_containers(ps_output: &str, stats_output: &str) -> Vec<DockerContainer> {
    // Парсим stats в map id → (cpu, mem, mem_limit, mem_pct)
    let mut stats_map: std::collections::HashMap<String, (f64, f64, f64, f64)> =
        std::collections::HashMap::new();

    for line in stats_output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') { continue; }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v["ID"].as_str().unwrap_or("").to_string();
            let cpu_str = v["CPUPerc"].as_str().unwrap_or("0%").trim_end_matches('%');
            let cpu = cpu_str.parse::<f64>().unwrap_or(0.0);

            let mem_str = v["MemUsage"].as_str().unwrap_or("0B / 0B");
            let (used, limit) = parse_mem_usage(mem_str);

            let mem_pct_str = v["MemPerc"].as_str().unwrap_or("0%").trim_end_matches('%');
            let mem_pct = mem_pct_str.parse::<f64>().unwrap_or(0.0);

            if !id.is_empty() {
                stats_map.insert(id, (cpu, used, limit, mem_pct));
            }
        }
    }

    let mut result = Vec::new();
    for line in ps_output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') { continue; }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v["ID"].as_str().unwrap_or("").to_string();
            let short_id = id.chars().take(12).collect();
            let name = v["Names"].as_str().unwrap_or("").trim_start_matches('/').to_string();
            let image = v["Image"].as_str().unwrap_or("").to_string();
            let image_id = v["ImageID"].as_str().unwrap_or("").to_string();
            let status = v["Status"].as_str().unwrap_or("").to_string();
            let state = v["State"].as_str().unwrap_or("").to_string();
            let created = v["CreatedAt"].as_str().unwrap_or("").to_string();
            let ports = v["Ports"].as_str().unwrap_or("").to_string();
            let command = v["Command"].as_str().unwrap_or("").trim_matches('"').to_string();

            let (cpu, mem, mem_limit, mem_pct) = stats_map
                .get(&id)
                .cloned()
                .unwrap_or((0.0, 0.0, 0.0, 0.0));

            result.push(DockerContainer {
                short_id,
                id,
                name,
                image,
                image_id,
                status,
                state,
                created,
                started_at: String::new(),
                ports,
                cpu_percent: cpu,
                mem_mb: mem,
                mem_limit_mb: mem_limit,
                mem_percent: mem_pct,
                command,
                restart_policy: String::new(),
                networks: String::new(),
            });
        }
    }
    result
}

fn parse_mem_usage(s: &str) -> (f64, f64) {
    // Формат: "123.4MiB / 1.5GiB"
    let parts: Vec<&str> = s.split(" / ").collect();
    let used = parse_size_to_mb(parts.first().copied().unwrap_or("0"));
    let limit = parse_size_to_mb(parts.get(1).copied().unwrap_or("0"));
    (used, limit)
}

fn parse_size_to_mb(s: &str) -> f64 {
    let s = s.trim();
    if let Some(v) = s.strip_suffix("GiB").or_else(|| s.strip_suffix("GB")) {
        return v.trim().parse::<f64>().unwrap_or(0.0) * 1024.0;
    }
    if let Some(v) = s.strip_suffix("MiB").or_else(|| s.strip_suffix("MB")) {
        return v.trim().parse::<f64>().unwrap_or(0.0);
    }
    if let Some(v) = s.strip_suffix("KiB").or_else(|| s.strip_suffix("kB") ) {
        return v.trim().parse::<f64>().unwrap_or(0.0) / 1024.0;
    }
    if let Some(v) = s.strip_suffix('B') {
        return v.trim().parse::<f64>().unwrap_or(0.0) / 1_048_576.0;
    }
    0.0
}

pub fn parse_container_detail(inspect_json: &str) -> Option<DockerContainerDetail> {
    let arr: Vec<Value> = serde_json::from_str(inspect_json).ok()?;
    let v = arr.first()?;

    let id = v["Id"].as_str().unwrap_or("").to_string();
    let name = v["Name"].as_str().unwrap_or("").trim_start_matches('/').to_string();
    let image = v["Config"]["Image"].as_str().unwrap_or("").to_string();

    let state = v.get("State").unwrap_or(&Value::Null);
    let status_str = state["Status"].as_str().unwrap_or("").to_string();
    let started_at = state["StartedAt"].as_str().unwrap_or("").to_string();
    let finished_at = state["FinishedAt"].as_str().unwrap_or("").to_string();
    let created = v["Created"].as_str().unwrap_or("").to_string();

    // Ports
    let mut ports = Vec::new();
    if let Some(port_map) = v["NetworkSettings"]["Ports"].as_object() {
        for (container_port, bindings) in port_map {
            if let Some(binds) = bindings.as_array() {
                for bind in binds {
                    let host_port = bind["HostPort"].as_str().unwrap_or("");
                    let host_ip = bind["HostIp"].as_str().unwrap_or("0.0.0.0");
                    ports.push(format!("{}:{} → {}", host_ip, host_port, container_port));
                }
            } else {
                ports.push(container_port.clone());
            }
        }
    }

    // Mounts
    let mut mounts = Vec::new();
    if let Some(mnt_arr) = v["Mounts"].as_array() {
        for m in mnt_arr {
            mounts.push(DockerMount {
                source: m["Source"].as_str().unwrap_or("").to_string(),
                destination: m["Destination"].as_str().unwrap_or("").to_string(),
                mode: m["Mode"].as_str().unwrap_or("").to_string(),
                mount_type: m["Type"].as_str().unwrap_or("").to_string(),
            });
        }
    }

    // Networks
    let mut networks = Vec::new();
    if let Some(nets) = v["NetworkSettings"]["Networks"].as_object() {
        for (net_name, _) in nets {
            networks.push(net_name.clone());
        }
    }

    // Restart policy
    let restart_policy = v["HostConfig"]["RestartPolicy"]["Name"]
        .as_str().unwrap_or("no").to_string();

    // Command
    let cmd_arr = v["Config"]["Cmd"].as_array();
    let command = cmd_arr
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" "))
        .unwrap_or_default();

    // Entrypoint
    let ep_arr = v["Config"]["Entrypoint"].as_array();
    let entrypoint = ep_arr
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" "))
        .unwrap_or_default();

    // Env — фильтруем секреты
    let mut env = Vec::new();
    if let Some(env_arr) = v["Config"]["Env"].as_array() {
        for e in env_arr {
            if let Some(s) = e.as_str() {
                let pos = s.find('=').unwrap_or(s.len());
                let key = &s[..pos];
                let val = if pos < s.len() { &s[pos + 1..] } else { "" };
                let display_val = if is_secret_key(key) { "***" } else { val };
                env.push((key.to_string(), display_val.to_string()));
            }
        }
    }

    Some(DockerContainerDetail {
        id, name, image,
        status: status_str,
        state: state["Status"].as_str().unwrap_or("").to_string(),
        created, started_at, finished_at,
        ports, mounts, networks, restart_policy,
        command, entrypoint, env,
    })
}

pub fn parse_images(output: &str) -> Vec<DockerImage> {
    let mut result = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') { continue; }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v["ID"].as_str().unwrap_or("").to_string();
            let short_id = id.chars().take(12).collect();
            let repo = v["Repository"].as_str().unwrap_or("<none>").to_string();
            let tag = v["Tag"].as_str().unwrap_or("<none>").to_string();
            let created = v["CreatedAt"].as_str().unwrap_or("").to_string();
            let size_str = v["Size"].as_str().unwrap_or("0B");
            let size_mb = parse_size_to_mb(size_str);
            result.push(DockerImage { id, short_id, repository: repo, tag, created, size_mb });
        }
    }
    result
}

pub fn parse_volumes(output: &str) -> Vec<DockerVolume> {
    let mut result = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') { continue; }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            result.push(DockerVolume {
                name: v["Name"].as_str().unwrap_or("").to_string(),
                driver: v["Driver"].as_str().unwrap_or("").to_string(),
                mountpoint: v["Mountpoint"].as_str().unwrap_or("").to_string(),
                created: v["CreatedAt"].as_str().unwrap_or("").to_string(),
                scope: v["Scope"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    result
}

pub fn parse_networks(output: &str) -> Vec<DockerNetwork> {
    let mut result = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') { continue; }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v["ID"].as_str().unwrap_or("").to_string();
            let short_id = id.chars().take(12).collect();
            result.push(DockerNetwork {
                short_id,
                id,
                name: v["Name"].as_str().unwrap_or("").to_string(),
                driver: v["Driver"].as_str().unwrap_or("").to_string(),
                scope: v["Scope"].as_str().unwrap_or("").to_string(),
                subnet: String::new(),
                gateway: String::new(),
                containers: Vec::new(),
            });
        }
    }
    result
}

pub fn parse_network_inspect(output: &str, base: DockerNetwork) -> DockerNetwork {
    let arr: Vec<Value> = match serde_json::from_str(output) {
        Ok(v) => v,
        Err(_) => return base,
    };
    let v = match arr.first() {
        Some(v) => v,
        None => return base,
    };

    let ipam = &v["IPAM"]["Config"];
    let subnet = ipam.as_array()
        .and_then(|a| a.first())
        .and_then(|c| c["Subnet"].as_str())
        .unwrap_or("").to_string();
    let gateway = ipam.as_array()
        .and_then(|a| a.first())
        .and_then(|c| c["Gateway"].as_str())
        .unwrap_or("").to_string();

    let mut containers = Vec::new();
    if let Some(ctrs) = v["Containers"].as_object() {
        for (_, ctr) in ctrs.iter().take(10) {
            if let Some(name) = ctr["Name"].as_str() {
                containers.push(name.to_string());
            }
        }
    }

    DockerNetwork { subnet, gateway, containers, ..base }
}
