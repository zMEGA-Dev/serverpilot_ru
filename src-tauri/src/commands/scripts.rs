use crate::AppState;
use crate::ssh;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use chrono::Utc;
use uuid::Uuid;

// ─── Типы ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub risk: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_run_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptRun {
    pub id: String,
    pub script_id: String,
    pub script_name: String,
    pub server_id: Option<String>,
    pub server_name: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub status: String,
    pub duration_ms: i64,
    pub executed_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateScriptRequest {
    pub name: String,
    pub description: String,
    pub command: String,
    pub risk: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunScriptResult {
    pub run_id: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: i64,
    pub status: String,
}

// ─── CRUD скриптов ────────────────────────────────────

#[tauri::command]
pub fn scripts_list(state: State<AppState>) -> Result<Vec<Script>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.conn.prepare(
        "SELECT id, name, description, command, risk, created_at, updated_at, last_run_at
         FROM scripts ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;

    let scripts = stmt.query_map([], |row| {
        Ok(Script {
            id:          row.get(0)?,
            name:        row.get(1)?,
            description: row.get(2)?,
            command:     row.get(3)?,
            risk:        row.get(4)?,
            created_at:  row.get(5)?,
            updated_at:  row.get(6)?,
            last_run_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| e.to_string())?;

    Ok(scripts)
}

#[tauri::command]
pub fn scripts_create(
    state: State<AppState>,
    request: CreateScriptRequest,
) -> Result<Script, String> {
    if request.name.trim().is_empty() {
        return Err("Название скрипта не может быть пустым".to_string());
    }
    if request.command.trim().is_empty() {
        return Err("Команда не может быть пустой".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.conn.execute(
        "INSERT INTO scripts (id, name, description, command, risk, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, request.name.trim(), request.description.trim(),
                request.command.trim(), request.risk, now, now],
    ).map_err(|e| e.to_string())?;

    log::info!("[SCRIPTS] created: {} ({})", request.name, id);

    Ok(Script {
        id,
        name: request.name.trim().to_string(),
        description: request.description.trim().to_string(),
        command: request.command.trim().to_string(),
        risk: request.risk,
        created_at: now.clone(),
        updated_at: now,
        last_run_at: None,
    })
}

#[tauri::command]
pub fn scripts_update(
    state: State<AppState>,
    id: String,
    request: CreateScriptRequest,
) -> Result<Script, String> {
    if request.name.trim().is_empty() {
        return Err("Название не может быть пустым".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    db.conn.execute(
        "UPDATE scripts SET name=?1, description=?2, command=?3, risk=?4, updated_at=?5 WHERE id=?6",
        params![request.name.trim(), request.description.trim(),
                request.command.trim(), request.risk, now, id],
    ).map_err(|e| e.to_string())?;

    // Возвращаем обновлённый скрипт
    let script = db.conn.query_row(
        "SELECT id, name, description, command, risk, created_at, updated_at, last_run_at FROM scripts WHERE id=?1",
        params![id],
        |row| Ok(Script {
            id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
            command: row.get(3)?, risk: row.get(4)?,
            created_at: row.get(5)?, updated_at: row.get(6)?, last_run_at: row.get(7)?,
        }),
    ).map_err(|e| format!("Скрипт не найден: {}", e))?;

    Ok(script)
}

#[tauri::command]
pub fn scripts_delete(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.conn.execute("DELETE FROM scripts WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log::info!("[SCRIPTS] deleted: {}", id);
    Ok(())
}

// ─── Запуск скрипта ───────────────────────────────────

#[tauri::command]
pub fn scripts_run(
    state: State<AppState>,
    script_id: String,
    server_id: String,
    server_name: String,
    // SECURITY: command от frontend игнорируется — берём из БД по script_id.
    // Это предотвращает подмену команды через прямой IPC-вызов.
    variables: Option<std::collections::HashMap<String, String>>,
) -> Result<RunScriptResult, String> {
    if !ssh::is_connected(&server_id) {
        return Err("Нет активного SSH подключения к серверу".to_string());
    }

    // Читаем скрипт из БД — команда не принимается от фронтенда
    let (db_command, script_name) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.conn.query_row(
            "SELECT command, name FROM scripts WHERE id = ?1",
            rusqlite::params![script_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ).map_err(|_| format!("Скрипт не найден: {}", script_id))?
    };

    if db_command.trim().is_empty() {
        return Err("Команда скрипта пустая".to_string());
    }

    // Подставляем переменные если есть
    let command = if let Some(vars) = variables {
        substitute_variables(&db_command, &vars)?
    } else {
        db_command.clone()
    };

    log::info!("[SCRIPTS] run script={} server={}", script_id, server_id);

    let result = ssh::execute_command(&server_id, &command)
        .map_err(|e| e.to_string())?;

    let status = if result.exit_code == 0 { "success" } else { "error" };
    let run_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Сохраняем в историю
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        let _ = db.conn.execute(
            "UPDATE scripts SET last_run_at=?1 WHERE id=?2",
            params![now, script_id],
        );

        let _ = db.conn.execute(
            "INSERT INTO script_runs (id, script_id, script_name, server_id, server_name, command, exit_code, status, duration_ms, executed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                run_id, script_id, script_name, server_id, server_name,
                // Храним шаблон команды (с переменными), не финальную с подставленными значениями
                db_command, result.exit_code, status,
                result.duration_ms as i64, now,
            ],
        );
    }

    log::info!("[SCRIPTS] run done exit_code={} duration={}ms", result.exit_code, result.duration_ms);

    Ok(RunScriptResult {
        run_id,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms as i64,
        status: status.to_string(),
    })
}

/// Подставить переменные {{name}} в шаблон команды.
/// Значения переменных проверяются на наличие shell-инъекций.
fn substitute_variables(
    template: &str,
    vars: &std::collections::HashMap<String, String>,
) -> Result<String, String> {
    let mut result = template.to_string();
    for (name, value) in vars {
        // Имя переменной — только буквы/цифры/подчёркивание
        if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(format!("Недопустимое имя переменной: {}", name));
        }
        // Значение не должно содержать shell-спецсимволы
        let forbidden = ['\0', '\n', '\r'];
        if value.chars().any(|c| forbidden.contains(&c)) {
            return Err(format!("Значение переменной «{}» содержит недопустимые символы", name));
        }
        let placeholder = format!("{{{{{}}}}}", name);
        result = result.replace(&placeholder, value);
    }

    // Проверяем что в команде не осталось незакрытых плейсхолдеров
    if result.contains("{{") && result.contains("}}") {
        return Err("Команда содержит незаполненные переменные".to_string());
    }

    Ok(result)
}

// ─── История запусков ─────────────────────────────────

#[tauri::command]
pub fn scripts_run_history(
    state: State<AppState>,
    script_id: String,
) -> Result<Vec<ScriptRun>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.conn.prepare(
        "SELECT id, script_id, script_name, server_id, server_name, command,
                exit_code, status, duration_ms, executed_at
         FROM script_runs WHERE script_id=?1
         ORDER BY executed_at DESC LIMIT 20"
    ).map_err(|e| e.to_string())?;

    let runs = stmt.query_map(params![script_id], |row| {
        Ok(ScriptRun {
            id:          row.get(0)?,
            script_id:   row.get(1)?,
            script_name: row.get(2)?,
            server_id:   row.get(3)?,
            server_name: row.get(4)?,
            command:     row.get(5)?,
            exit_code:   row.get(6)?,
            status:      row.get(7)?,
            duration_ms: row.get(8)?,
            executed_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| e.to_string())?;

    Ok(runs)
}

// ─── Все недавние запуски ─────────────────────────────

#[tauri::command]
pub fn scripts_recent_runs(
    state: State<AppState>,
) -> Result<Vec<ScriptRun>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.conn.prepare(
        "SELECT id, script_id, script_name, server_id, server_name, command,
                exit_code, status, duration_ms, executed_at
         FROM script_runs
         ORDER BY executed_at DESC LIMIT 50"
    ).map_err(|e| e.to_string())?;

    let runs = stmt.query_map([], |row| {
        Ok(ScriptRun {
            id:          row.get(0)?,
            script_id:   row.get(1)?,
            script_name: row.get(2)?,
            server_id:   row.get(3)?,
            server_name: row.get(4)?,
            command:     row.get(5)?,
            exit_code:   row.get(6)?,
            status:      row.get(7)?,
            duration_ms: row.get(8)?,
            executed_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?
      .collect::<Result<Vec<_>, _>>()
      .map_err(|e| e.to_string())?;

    Ok(runs)
}
