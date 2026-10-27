use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;

pub struct Database {
    pub conn: Connection,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = Self::get_db_path()?;

        // Создаём директорию если не существует
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;

        // Включаем WAL для лучшей производительности
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        let db = Database { conn };
        db.migrate()?;

        log::info!("База данных инициализирована: {:?}", db_path);
        Ok(db)
    }

    fn get_db_path() -> Result<PathBuf> {
        let data_dir = dirs::data_local_dir()
            .ok_or_else(|| anyhow::anyhow!("Не удалось найти директорию данных"))?;

        Ok(data_dir.join("ServerPilotRU").join("data.db"))
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS server_credentials (
                server_id TEXT NOT NULL,
                credential_type TEXT NOT NULL,
                encrypted_value TEXT NOT NULL,
                PRIMARY KEY (server_id, credential_type)
            );

            CREATE TABLE IF NOT EXISTS servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL DEFAULT 'password',
                key_path TEXT,
                group_name TEXT,
                tags TEXT DEFAULT '[]',
                description TEXT DEFAULT '',
                color TEXT DEFAULT '#4f8ef7',
                favorite INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS server_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#4f8ef7',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS command_history (
                id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                command TEXT NOT NULL,
                output TEXT,
                exit_code INTEGER,
                executed_at TEXT NOT NULL,
                duration_ms INTEGER,
                FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS scripts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                command TEXT NOT NULL,
                risk TEXT DEFAULT 'low',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_run_at TEXT
            );

            CREATE TABLE IF NOT EXISTS script_runs (
                id TEXT PRIMARY KEY,
                script_id TEXT NOT NULL,
                script_name TEXT NOT NULL,
                server_id TEXT,
                server_name TEXT DEFAULT '',
                command TEXT NOT NULL,
                exit_code INTEGER,
                status TEXT NOT NULL DEFAULT 'success',
                duration_ms INTEGER DEFAULT 0,
                executed_at TEXT NOT NULL,
                FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                api_url TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT 'gpt-4o',
                temperature REAL DEFAULT 0.3,
                max_tokens INTEGER DEFAULT 2000,
                is_active INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                server_id TEXT,
                title TEXT NOT NULL,
                messages TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                server_id TEXT,
                server_name TEXT,
                action TEXT NOT NULL,
                command TEXT,
                result TEXT,
                success INTEGER DEFAULT 1,
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_command_history_server ON command_history(server_id);
            CREATE INDEX IF NOT EXISTS idx_audit_log_server ON audit_log(server_id);
            CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

            CREATE TABLE IF NOT EXISTS backups (
                id TEXT PRIMARY KEY,
                server_id TEXT NOT NULL,
                server_name TEXT NOT NULL DEFAULT '',
                source_path TEXT NOT NULL,
                archive_name TEXT NOT NULL,
                archive_path TEXT NOT NULL,
                size_bytes INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'creating',
                error_message TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                downloaded_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_backups_server ON backups(server_id);
            CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at);
            ",
        )?;
        Ok(())
    }
}
