mod commands;
mod database;
mod crypto;
mod servers;
mod ssh;
mod monitoring;
mod files;
mod processes;
mod pm2;
mod docker;
mod pty;
mod git;
mod nginx;
mod security;

// Security regression tests (только в тестовой сборке)
#[cfg(test)]
mod security_tests;

use database::Database;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Database>,
}

fn init_logger() {
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ServerPilotRU")
        .join("logs");
    std::fs::create_dir_all(&log_dir).ok();

    let log_path = log_dir.join("app.log");

    // Ротируем при > 5 МБ
    if std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0) > 5 * 1024 * 1024 {
        std::fs::rename(&log_path, log_dir.join("app.old.log")).ok();
    }

    let mut builder = env_logger::Builder::new();
    // Debug в dev-режиме, Info в production build
    #[cfg(debug_assertions)]
    builder.filter_level(log::LevelFilter::Debug);
    #[cfg(not(debug_assertions))]
    builder.filter_level(log::LevelFilter::Info);
    builder.format_timestamp_millis();

    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        builder.target(env_logger::Target::Pipe(Box::new(file)));
    }

    // try_init не паникует если логгер уже инициализирован
    builder.try_init().ok();

    log::info!("=== ServerPilot RU start === log={:?}", log_path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Инициализация логгера
    // Логи пишутся в %LOCALAPPDATA%/ServerPilotRU/logs/app.log
    init_logger();

    // Инициализация базы данных
    let db = Database::new().expect("Не удалось инициализировать базу данных");

    let state = AppState {
        db: Mutex::new(db),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::servers::get_servers,
            commands::servers::add_server,
            commands::servers::update_server,
            commands::servers::update_server_credentials,
            commands::servers::has_server_credentials,
            commands::servers::delete_server,
            commands::servers::get_server,
            commands::ssh::test_ssh_connection,
            commands::ssh::connect_ssh,
            commands::ssh::disconnect_ssh,
            commands::ssh::execute_command,
            commands::monitoring::get_server_stats,
            commands::monitoring::run_command,
            commands::app::get_app_version,
            commands::app::get_app_data_dir,
            commands::app::open_external_url,
            commands::files::sftp_list_dir,
            commands::files::sftp_stat,
            commands::files::sftp_read_file,
            commands::files::sftp_write_file,
            commands::files::sftp_create_dir,
            commands::files::sftp_create_file,
            commands::files::sftp_rename,
            commands::files::sftp_delete_file,
            commands::files::sftp_delete_dir,
            commands::files::sftp_download_file,
            commands::files::sftp_upload_file,
            commands::files::sftp_chmod,
            commands::files::sftp_sanitize_path,
            commands::processes::get_processes,
            commands::processes::get_process_detail,
            commands::processes::kill_process,
            commands::processes::kill_process_force,
            commands::pm2::pm2_detect,
            commands::pm2::pm2_list,
            commands::pm2::pm2_detail,
            commands::pm2::pm2_action,
            commands::pm2::pm2_logs,
            commands::pm2::pm2_start_new,
            commands::docker::docker_detect,
            commands::docker::docker_list_containers,
            commands::docker::docker_container_detail,
            commands::docker::docker_container_logs,
            commands::docker::docker_container_action,
            commands::docker::docker_list_images,
            commands::docker::docker_pull_image,
            commands::docker::docker_remove_image,
            commands::docker::docker_list_volumes,
            commands::docker::docker_remove_volume,
            commands::docker::docker_list_networks,
            commands::docker::docker_inspect_network,
            commands::pty::pty_open,
            commands::pty::pty_write,
            commands::pty::pty_read,
            commands::pty::pty_resize,
            commands::pty::pty_close,
            commands::pty::pty_alive,
            commands::git::git_detect,
            commands::git::git_repo_status,
            commands::git::git_clone,
            commands::git::git_pull,
            commands::nginx::nginx_detect,
            commands::nginx::nginx_list_sites,
            commands::nginx::nginx_read_config,
            commands::nginx::nginx_write_config,
            commands::nginx::nginx_test_config,
            commands::nginx::nginx_reload,
            commands::nginx::nginx_enable_site,
            commands::nginx::nginx_disable_site,
            commands::nginx::nginx_create_site,
            commands::nginx::nginx_delete_config,
            commands::nginx::nginx_restore_backup,
            commands::ssl::ssl_detect_certbot,
            commands::ssl::ssl_check_site,
            commands::ssl::ssl_cert_days,
            commands::ssl::ssl_list_certs,
            commands::ssl::ssl_obtain_cert,
            commands::ssl::ssl_renewal_status,
            commands::ssl::ssl_renewal_dry_run,
            commands::security::run_security_audit,
            commands::scripts::scripts_list,
            commands::scripts::scripts_create,
            commands::scripts::scripts_update,
            commands::scripts::scripts_delete,
            commands::scripts::scripts_run,
            commands::scripts::scripts_run_history,
            commands::scripts::scripts_recent_runs,
            commands::backups::backup_check_space,
            commands::backups::backup_create,
            commands::backups::backup_download,
            commands::backups::backup_delete_remote,
            commands::backups::backup_delete_record,
            commands::backups::backup_list,
        ])
        .run(tauri::generate_context!())
        .expect("Ошибка при запуске ServerPilot RU");
}
