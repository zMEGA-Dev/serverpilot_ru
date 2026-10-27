use crate::docker::{self, *};
use crate::ssh;
use crate::AppState;
use tauri::State;

// ─── Обнаружение Docker ──────────────────────────────

#[tauri::command]
pub fn docker_detect(
    _state: State<AppState>,
    server_id: String,
) -> Result<DockerInfo, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения".to_string());
    }

    // Шаг 1: есть ли docker CLI
    let ver_result = ssh::execute_command(&server_id, "docker --version 2>&1")
        .map_err(|e| e.to_string())?;

    if ver_result.exit_code != 0 || !ver_result.stdout.to_lowercase().contains("docker") {
        return Ok(DockerInfo {
            installed: false,
            version: String::new(),
            daemon_running: false,
            has_permission: false,
            error: String::new(),
        });
    }

    let version_line = ver_result.stdout.lines().next().unwrap_or("").trim().to_string();
    // Извлекаем версию: "Docker version 24.0.5, build ..."
    let version = version_line
        .split_whitespace()
        .nth(2)
        .unwrap_or("")
        .trim_end_matches(',')
        .to_string();

    // Шаг 2: daemon доступен?
    let info_result = ssh::execute_command(&server_id, "docker info 2>&1")
        .map_err(|e| e.to_string())?;

    let output = info_result.stdout.to_lowercase();
    let daemon_running = info_result.exit_code == 0
        && !output.contains("cannot connect")
        && !output.contains("is the docker daemon running")
        && !output.contains("connection refused");

    let has_permission = daemon_running
        && !output.contains("permission denied")
        && !output.contains("got permission denied");

    let error = if !daemon_running {
        "Docker daemon недоступен или у пользователя нет прав на выполнение Docker-команд. \
         Проверьте что daemon запущен и пользователь добавлен в группу docker."
            .to_string()
    } else if !has_permission {
        "Недостаточно прав. Добавьте пользователя в группу docker: sudo usermod -aG docker $USER"
            .to_string()
    } else {
        String::new()
    };

    Ok(DockerInfo { installed: true, version, daemon_running, has_permission, error })
}

// ─── Контейнеры ─────────────────────────────────────

#[tauri::command]
pub fn docker_list_containers(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<DockerContainer>, String> {
    ensure_connected(&server_id)?;

    let ps = ssh::execute_command(&server_id, docker::LIST_CONTAINERS_CMD)
        .map_err(|e| e.to_string())?;

    // Stats только для запущенных (не блокируем если нет running)
    let stats_output = ssh::execute_command(&server_id, docker::STATS_CONTAINERS_CMD)
        .map(|r| r.stdout)
        .unwrap_or_default();

    Ok(docker::parse_containers(&ps.stdout, &stats_output))
}

#[tauri::command]
pub fn docker_container_detail(
    _state: State<AppState>,
    server_id: String,
    container_id: String,
) -> Result<DockerContainerDetail, String> {
    ensure_connected(&server_id)?;
    let cmd = docker::inspect_container_cmd(&container_id).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let output = result.stdout.trim();
    if output.is_empty() || result.exit_code != 0 {
        return Err(format_docker_error(&result.stdout, &result.stderr, "получить детали контейнера"));
    }
    docker::parse_container_detail(output)
        .ok_or_else(|| "Не удалось разобрать информацию о контейнере".to_string())
}

#[tauri::command]
pub fn docker_container_logs(
    _state: State<AppState>,
    server_id: String,
    container_id: String,
    lines: u32,
) -> Result<String, String> {
    ensure_connected(&server_id)?;
    let cmd = docker::container_logs_cmd(&container_id, lines).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let output = format!("{}{}", result.stdout, result.stderr);
    if output.trim().is_empty() {
        Ok("Логи пусты".to_string())
    } else {
        Ok(output)
    }
}

#[tauri::command]
pub fn docker_container_action(
    _state: State<AppState>,
    server_id: String,
    action: String,
    container_id: String,
) -> Result<DockerActionResult, String> {
    ensure_connected(&server_id)?;
    let allowed = ["start", "stop", "restart", "pause", "unpause", "remove"];
    if !allowed.contains(&action.as_str()) {
        return Err(format!("Недопустимое действие: {}", action));
    }
    let cmd = docker::container_action_cmd(&action, &container_id).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let success = result.exit_code == 0;
    let output = format!("{}{}", result.stdout, result.stderr).trim().to_string();
    let message = if success {
        let label = action_label(&action);
        format!("Контейнер {} успешно", label)
    } else {
        format_docker_error(&result.stdout, &result.stderr, &format!("выполнить {}", action))
    };
    Ok(DockerActionResult { success, message, output })
}

// ─── Образы ──────────────────────────────────────────

#[tauri::command]
pub fn docker_list_images(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<DockerImage>, String> {
    ensure_connected(&server_id)?;
    let result = ssh::execute_command(&server_id, docker::LIST_IMAGES_CMD)
        .map_err(|e| e.to_string())?;
    Ok(docker::parse_images(&result.stdout))
}

#[tauri::command]
pub fn docker_pull_image(
    _state: State<AppState>,
    server_id: String,
    image: String,
) -> Result<DockerActionResult, String> {
    ensure_connected(&server_id)?;
    let cmd = docker::pull_image_cmd(&image).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let success = result.exit_code == 0;
    let output = format!("{}{}", result.stdout, result.stderr).trim().to_string();
    let message = if success {
        format!("Образ {} успешно загружен", image)
    } else {
        format_docker_error(&result.stdout, &result.stderr, &format!("загрузить образ {}", image))
    };
    Ok(DockerActionResult { success, message, output })
}

#[tauri::command]
pub fn docker_remove_image(
    _state: State<AppState>,
    server_id: String,
    image_id: String,
) -> Result<DockerActionResult, String> {
    ensure_connected(&server_id)?;
    let cmd = docker::remove_image_cmd(&image_id).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let success = result.exit_code == 0;
    let output = format!("{}{}", result.stdout, result.stderr).trim().to_string();
    let message = if success {
        "Образ удалён".to_string()
    } else {
        format_docker_error(&result.stdout, &result.stderr, "удалить образ")
    };
    Ok(DockerActionResult { success, message, output })
}

// ─── Тома ────────────────────────────────────────────

#[tauri::command]
pub fn docker_list_volumes(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<DockerVolume>, String> {
    ensure_connected(&server_id)?;
    let result = ssh::execute_command(&server_id, docker::LIST_VOLUMES_CMD)
        .map_err(|e| e.to_string())?;
    Ok(docker::parse_volumes(&result.stdout))
}

#[tauri::command]
pub fn docker_remove_volume(
    _state: State<AppState>,
    server_id: String,
    name: String,
) -> Result<DockerActionResult, String> {
    ensure_connected(&server_id)?;
    let cmd = docker::remove_volume_cmd(&name).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;
    let success = result.exit_code == 0;
    let output = format!("{}{}", result.stdout, result.stderr).trim().to_string();
    let message = if success {
        format!("Том «{}» удалён", name)
    } else {
        format_docker_error(&result.stdout, &result.stderr, "удалить том")
    };
    Ok(DockerActionResult { success, message, output })
}

// ─── Сети ────────────────────────────────────────────

#[tauri::command]
pub fn docker_list_networks(
    _state: State<AppState>,
    server_id: String,
) -> Result<Vec<DockerNetwork>, String> {
    ensure_connected(&server_id)?;
    let result = ssh::execute_command(&server_id, docker::LIST_NETWORKS_CMD)
        .map_err(|e| e.to_string())?;
    Ok(docker::parse_networks(&result.stdout))
}

#[tauri::command]
pub fn docker_inspect_network(
    _state: State<AppState>,
    server_id: String,
    network_id: String,
) -> Result<DockerNetwork, String> {
    ensure_connected(&server_id)?;

    // Сначала получаем базовые данные из списка
    let ls_result = ssh::execute_command(&server_id, docker::LIST_NETWORKS_CMD)
        .map_err(|e| e.to_string())?;
    let all = docker::parse_networks(&ls_result.stdout);
    let base = all.into_iter()
        .find(|n| n.id == network_id || n.short_id == network_id || n.name == network_id)
        .ok_or_else(|| format!("Сеть «{}» не найдена", network_id))?;

    let cmd = docker::inspect_network_cmd(&network_id).map_err(|e| e.to_string())?;
    let result = ssh::execute_command(&server_id, &cmd).map_err(|e| e.to_string())?;

    Ok(docker::parse_network_inspect(&result.stdout, base))
}

// ─── Вспомогательные функции ─────────────────────────

fn ensure_connected(server_id: &str) -> Result<(), String> {
    if !ssh::is_connected(server_id) {
        Err("Нет активного SSH подключения к серверу".to_string())
    } else {
        Ok(())
    }
}

fn format_docker_error(stdout: &str, stderr: &str, action: &str) -> String {
    let combined = format!("{}{}", stdout, stderr).trim().to_string();
    let first_line = combined.lines().next().unwrap_or("").trim();

    if first_line.contains("permission denied") || first_line.contains("Got permission denied") {
        return format!(
            "Не удалось {}.\n\nОтказано в доступе. Добавьте пользователя в группу docker:\nsudo usermod -aG docker $USER",
            action
        );
    }
    if first_line.contains("No such container") || first_line.contains("No such image") {
        return format!("Не удалось {}.\n\nОбъект не найден.", action);
    }
    if first_line.contains("is not running") {
        return format!("Не удалось {}.\n\nКонтейнер не запущен.", action);
    }
    if first_line.contains("already started") {
        return format!("Не удалось {}.\n\nКонтейнер уже запущен.", action);
    }
    if combined.is_empty() {
        return format!("Не удалось {}. Неизвестная ошибка Docker.", action);
    }
    format!("Не удалось {}.\n\nDocker:\n{}", action, first_line)
}

fn action_label(action: &str) -> &'static str {
    match action {
        "start"   => "запущен",
        "stop"    => "остановлен",
        "restart" => "перезапущен",
        "pause"   => "приостановлен",
        "unpause" => "возобновлён",
        "remove"  => "удалён",
        _ => "обработан",
    }
}
