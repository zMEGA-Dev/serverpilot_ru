use crate::AppState;
use crate::crypto;
use crate::servers::{Server, CreateServerRequest, UpdateServerRequest, AuthType};
use rusqlite::params;
use serde_json;
use tauri::State;
use chrono::Utc;
use uuid::Uuid;

#[tauri::command]
pub fn get_servers(state: State<AppState>) -> Result<Vec<Server>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .conn
        .prepare(
            "SELECT id, name, host, port, username, auth_type, key_path,
                    group_name, tags, description, color, favorite, created_at, updated_at
             FROM servers ORDER BY favorite DESC, name ASC",
        )
        .map_err(|e| e.to_string())?;

    let servers = stmt
        .query_map([], |row| {
            let tags_str: String = row.get(8)?;
            let tags: Vec<String> =
                serde_json::from_str(&tags_str).unwrap_or_default();
            let auth_type_str: String = row.get(5)?;
            let favorite: i32 = row.get(11)?;

            Ok(Server {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, u16>(3)?,
                username: row.get(4)?,
                auth_type: AuthType::from(auth_type_str.as_str()),
                key_path: row.get(6)?,
                group_name: row.get(7)?,
                tags,
                description: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                color: row.get::<_, Option<String>>(10)?.unwrap_or_else(|| "#4f8ef7".to_string()),
                favorite: favorite != 0,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(servers)
}

#[tauri::command]
pub fn get_server(state: State<AppState>, id: String) -> Result<Server, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let server = db
        .conn
        .query_row(
            "SELECT id, name, host, port, username, auth_type, key_path,
                    group_name, tags, description, color, favorite, created_at, updated_at
             FROM servers WHERE id = ?1",
            params![id],
            |row| {
                let tags_str: String = row.get(8)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                let auth_type_str: String = row.get(5)?;
                let favorite: i32 = row.get(11)?;

                Ok(Server {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get::<_, u16>(3)?,
                    username: row.get(4)?,
                    auth_type: AuthType::from(auth_type_str.as_str()),
                    key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    tags,
                    description: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    color: row.get::<_, Option<String>>(10)?.unwrap_or_else(|| "#4f8ef7".to_string()),
                    favorite: favorite != 0,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            },
        )
        .map_err(|e| format!("Сервер не найден: {}", e))?;

    Ok(server)
}

#[tauri::command]
pub fn add_server(state: State<AppState>, request: CreateServerRequest) -> Result<Server, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    // Извлекаем опциональные поля заранее, чтобы не было borrow after move
    let tags = request.tags.unwrap_or_default();
    let description = request.description.unwrap_or_default();
    let color = request.color.unwrap_or_else(|| "#4f8ef7".to_string());
    let favorite = request.favorite.unwrap_or(false);

    let tags_json = serde_json::to_string(&tags)
        .map_err(|e| e.to_string())?;

    // Шифруем пароль и passphrase перед сохранением
    if let Some(ref password) = request.password {
        let encrypted = crypto::encrypt(password).map_err(|e| e.to_string())?;
        db.conn.execute(
            "INSERT OR REPLACE INTO server_credentials (server_id, credential_type, encrypted_value) VALUES (?1, 'password', ?2)",
            params![id, encrypted],
        ).map_err(|e| e.to_string())?;
    }

    if let Some(ref passphrase) = request.key_passphrase {
        if !passphrase.is_empty() {
            let encrypted = crypto::encrypt(passphrase).map_err(|e| e.to_string())?;
            db.conn.execute(
                "INSERT OR REPLACE INTO server_credentials (server_id, credential_type, encrypted_value) VALUES (?1, 'passphrase', ?2)",
                params![id, encrypted],
            ).map_err(|e| e.to_string())?;
        }
    }

    db.conn
        .execute(
            "INSERT INTO servers (id, name, host, port, username, auth_type, key_path,
                                   group_name, tags, description, color, favorite, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id,
                request.name,
                request.host,
                request.port,
                request.username,
                request.auth_type,
                request.key_path,
                request.group_name,
                tags_json,
                description,
                color,
                favorite as i32,
                now,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

    log::info!("Сервер добавлен: {} ({})", request.name, id);

    Ok(Server {
        id,
        name: request.name,
        host: request.host,
        port: request.port,
        username: request.username,
        auth_type: AuthType::from(request.auth_type.as_str()),
        key_path: request.key_path,
        group_name: request.group_name,
        tags,
        description,
        color,
        favorite,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_server(state: State<AppState>, request: UpdateServerRequest) -> Result<Server, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    // Получаем текущие данные
    let existing = db.conn.query_row(
        "SELECT id, name, host, port, username, auth_type, key_path, group_name, tags, description, color, favorite, created_at, updated_at FROM servers WHERE id = ?1",
        params![request.id],
        |row| {
            let tags_str: String = row.get(8)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            let auth_type_str: String = row.get(5)?;
            let favorite: i32 = row.get(11)?;
            Ok(Server {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, u16>(3)?,
                username: row.get(4)?,
                auth_type: AuthType::from(auth_type_str.as_str()),
                key_path: row.get(6)?,
                group_name: row.get(7)?,
                tags,
                description: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                color: row.get::<_, Option<String>>(10)?.unwrap_or_else(|| "#4f8ef7".to_string()),
                favorite: favorite != 0,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        },
    ).map_err(|e| e.to_string())?;

    let name = request.name.unwrap_or(existing.name);
    let host = request.host.unwrap_or(existing.host);
    let port = request.port.unwrap_or(existing.port);
    let username = request.username.unwrap_or(existing.username);
    let key_path = request.key_path.or(existing.key_path);
    let group_name = request.group_name.or(existing.group_name);
    let tags = request.tags.unwrap_or(existing.tags);
    let description = request.description.unwrap_or(existing.description);
    let color = request.color.unwrap_or(existing.color);
    let favorite = request.favorite.unwrap_or(existing.favorite);

    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;

    db.conn.execute(
        "UPDATE servers SET name=?1, host=?2, port=?3, username=?4, key_path=?5, group_name=?6,
         tags=?7, description=?8, color=?9, favorite=?10, updated_at=?11 WHERE id=?12",
        params![
            name, host, port, username, key_path, group_name,
            tags_json, description, color, favorite as i32, now, request.id
        ],
    ).map_err(|e| e.to_string())?;

    Ok(Server {
        id: request.id,
        name,
        host,
        port,
        username,
        auth_type: existing.auth_type,
        key_path,
        group_name,
        tags,
        description,
        color,
        favorite,
        created_at: existing.created_at,
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_server(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    db.conn
        .execute("DELETE FROM servers WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    // Отключаемся от сервера если подключены
    crate::ssh::disconnect(&id);

    log::info!("Сервер удалён: {}", id);
    Ok(())
}

/// Обновить только credentials сервера (пароль / passphrase).
#[tauri::command]
pub fn update_server_credentials(
    state: State<AppState>,
    server_id: String,
    password: Option<String>,
    key_passphrase: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    if let Some(ref pw) = password {
        if !pw.is_empty() {
            let encrypted = crypto::encrypt(pw).map_err(|e| e.to_string())?;
            db.conn.execute(
                "INSERT OR REPLACE INTO server_credentials (server_id, credential_type, encrypted_value) VALUES (?1, 'password', ?2)",
                params![server_id, encrypted],
            ).map_err(|e| e.to_string())?;
        }
    }

    if let Some(ref pp) = key_passphrase {
        if !pp.is_empty() {
            let encrypted = crypto::encrypt(pp).map_err(|e| e.to_string())?;
            db.conn.execute(
                "INSERT OR REPLACE INTO server_credentials (server_id, credential_type, encrypted_value) VALUES (?1, 'passphrase', ?2)",
                params![server_id, encrypted],
            ).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Проверить, есть ли сохранённые credentials для сервера.
#[tauri::command]
pub fn has_server_credentials(
    state: State<AppState>,
    server_id: String,
    credential_type: String,
) -> bool {
    let Ok(db) = state.db.lock() else { return false };
    db.conn.query_row(
        "SELECT COUNT(*) FROM server_credentials WHERE server_id = ?1 AND credential_type = ?2",
        params![server_id, credential_type],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0
}
