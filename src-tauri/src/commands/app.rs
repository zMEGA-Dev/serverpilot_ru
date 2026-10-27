use tauri::AppHandle;

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_app_data_dir() -> Result<String, String> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| "Не удалось определить директорию данных".to_string())?;
    Ok(dir.join("ServerPilotRU").to_string_lossy().to_string())
}

/// Открыть URL во внешнем браузере.
/// Разрешены только доверенные URL проекта.
#[tauri::command]
pub fn open_external_url(_app: AppHandle, url: String) -> Result<(), String> {
    // Whitelist — только разрешённые URL
    const ALLOWED: &[&str] = &[
        "https://serpmax.ru",
        "https://vibes.su",
        "https://github.com",
        "https://pay.cloudtips.ru",
        "https://capitalist.net",
    ];

    let allowed = ALLOWED.iter().any(|allowed| url.starts_with(allowed));
    if !allowed {
        return Err(format!("URL не разрешён: {}", url));
    }

    // Открываем через shell plugin
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Не удалось открыть URL: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Не удалось открыть URL: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Не удалось открыть URL: {}", e))?;
    }

    Ok(())
}
