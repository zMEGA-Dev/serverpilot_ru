use anyhow::Result;

// ─── Валидация входных данных ────────────────────────
// Все параметры от пользователя проходят через эти функции
// перед тем как попасть в shell-команду.

/// Проверить Git URL — только известные безопасные форматы.
pub fn validate_git_url(url: &str) -> Result<String> {
    let url = url.trim();
    if url.is_empty() {
        return Err(anyhow::anyhow!("URL репозитория не может быть пустым"));
    }

    // Запрещаем shell-спецсимволы
    let forbidden = [';', '&', '|', '`', '$', '(', ')', '<', '>', '\0', '\n', '\r'];
    if url.chars().any(|c| forbidden.contains(&c)) {
        return Err(anyhow::anyhow!("URL содержит недопустимые символы"));
    }

    // Разрешаем только известные форматы
    let ok = url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("git@")
        || url.starts_with("ssh://");

    if !ok {
        return Err(anyhow::anyhow!(
            "Неподдерживаемый формат URL. Используйте https:// или git@"
        ));
    }

    if url.len() > 512 {
        return Err(anyhow::anyhow!("URL слишком длинный"));
    }

    Ok(url.to_string())
}

/// Проверить имя ветки — только [a-zA-Z0-9_./\-].
pub fn validate_branch(branch: &str) -> Result<String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(anyhow::anyhow!("Имя ветки не может быть пустым"));
    }

    let ok = branch.chars().all(|c| {
        c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '/')
    });

    if !ok {
        return Err(anyhow::anyhow!("Имя ветки содержит недопустимые символы"));
    }

    if branch.len() > 128 {
        return Err(anyhow::anyhow!("Имя ветки слишком длинное"));
    }

    Ok(branch.to_string())
}

/// Проверить путь директории на сервере.
pub fn validate_directory(dir: &str) -> Result<String> {
    let dir = dir.trim();
    if dir.is_empty() {
        return Err(anyhow::anyhow!("Директория не может быть пустой"));
    }

    // Запрещаем shell-спецсимволы
    let forbidden = [';', '&', '|', '`', '$', '(', ')', '<', '>', '\0', '\n', '\r'];
    if dir.chars().any(|c| forbidden.contains(&c)) {
        return Err(anyhow::anyhow!("Путь содержит недопустимые символы"));
    }

    // Запрещаем path traversal
    if dir.contains("..") {
        return Err(anyhow::anyhow!("Путь не может содержать '..'"));
    }

    // Должен быть абсолютным
    if !dir.starts_with('/') {
        return Err(anyhow::anyhow!("Путь должен быть абсолютным (начинаться с '/')"));
    }

    // Запрещаем системные директории
    let forbidden_dirs = ["/", "/etc", "/bin", "/sbin", "/usr/bin", "/usr/sbin",
        "/boot", "/dev", "/proc", "/sys", "/root"];
    if forbidden_dirs.contains(&dir) {
        return Err(anyhow::anyhow!("Нельзя использовать системную директорию: {}", dir));
    }

    if dir.len() > 512 {
        return Err(anyhow::anyhow!("Путь слишком длинный"));
    }

    Ok(dir.to_string())
}

// ─── Команды Git ─────────────────────────────────────

/// Проверить установлен ли Git.
pub const GIT_VERSION_CMD: &str = "git --version 2>&1 || echo GIT_NOT_FOUND";

/// Проверить состояние существующего репозитория.
#[allow(dead_code)]
pub fn git_status_cmd(dir: &str) -> Result<String> {
    let d = validate_directory(dir)?;
    Ok(format!(
        "cd {:?} 2>&1 && git status 2>&1 && echo '---BRANCH---' && git rev-parse --abbrev-ref HEAD 2>&1 && echo '---COMMIT---' && git log -1 --format='%H %s' 2>&1",
        d
    ))
}

/// Проверить является ли директория git-репозиторием.
pub fn git_is_repo_cmd(dir: &str) -> Result<String> {
    let d = validate_directory(dir)?;
    Ok(format!("test -d {:?}/.git && echo IS_GIT_REPO || echo NOT_GIT_REPO", d))
}

/// Клонировать репозиторий.
pub fn git_clone_cmd(url: &str, branch: &str, dir: &str) -> Result<String> {
    let u = validate_git_url(url)?;
    let b = validate_branch(branch)?;
    let d = validate_directory(dir)?;

    // Используем -- чтобы отделить параметры от URL
    Ok(format!(
        "git clone --progress -b {:?} -- {:?} {:?} 2>&1",
        b, u, d
    ))
}

/// Обновить репозиторий (pull).
pub fn git_pull_cmd(dir: &str, branch: &str) -> Result<String> {
    let d = validate_directory(dir)?;
    let b = validate_branch(branch)?;

    Ok(format!(
        "cd {:?} 2>&1 && git fetch --all 2>&1 && git pull origin {:?} 2>&1",
        d, b
    ))
}

/// Получить информацию о репозитории (ветка + последний коммит).
pub fn git_info_cmd(dir: &str) -> Result<String> {
    let d = validate_directory(dir)?;
    Ok(format!(
        "cd {:?} 2>&1 && git rev-parse --abbrev-ref HEAD 2>&1 && git log -1 --format='COMMIT:%H%nMESSAGE:%s%nAUTHOR:%an%nDATE:%ci' 2>&1",
        d
    ))
}

/// Проверить наличие незакоммиченных изменений.
pub fn git_has_changes_cmd(dir: &str) -> Result<String> {
    let d = validate_directory(dir)?;
    Ok(format!(
        "cd {:?} 2>&1 && git status --porcelain 2>&1 | head -20",
        d
    ))
}

// ─── Парсинг вывода ───────────────────────────────────

pub struct GitInfo {
    pub branch: String,
    pub commit_hash: String,
    pub commit_message: String,
    pub commit_author: String,
    pub commit_date: String,
}

pub fn parse_git_info(output: &str) -> GitInfo {
    let mut info = GitInfo {
        branch: String::new(),
        commit_hash: String::new(),
        commit_message: String::new(),
        commit_author: String::new(),
        commit_date: String::new(),
    };

    let lines: Vec<&str> = output.lines().collect();
    if let Some(branch) = lines.first() {
        info.branch = branch.trim().to_string();
    }
    for line in &lines[1..] {
        if let Some(v) = line.strip_prefix("COMMIT:") { info.commit_hash = v.chars().take(12).collect(); }
        if let Some(v) = line.strip_prefix("MESSAGE:") { info.commit_message = v.to_string(); }
        if let Some(v) = line.strip_prefix("AUTHOR:") { info.commit_author = v.to_string(); }
        if let Some(v) = line.strip_prefix("DATE:") { info.commit_date = v.to_string(); }
    }
    info
}

/// Отфильтровать credentials из git output перед показом пользователю.
/// Очищает все URL формата https://user:token@host и https://token@host.
pub fn sanitize_git_output(output: &str) -> String {
    output.lines()
        .map(|line| sanitize_git_line(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Очистить credentials из одной строки.
/// Алгоритм: однократный линейный проход по строке без рекурсии.
fn sanitize_git_line(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut remaining = line;

    while let Some(https_pos) = remaining.find("https://") {
        // Добавляем всё до https://
        result.push_str(&remaining[..https_pos]);
        let after_scheme = &remaining[https_pos + "https://".len()..];

        // Ищем @ — признак credentials в URL
        // Ограничиваем поиск до ближайшего пробела/кавычки чтобы не захватить @ из другого URL
        let url_boundary = after_scheme
            .find(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | ')' | ']' | '>'))
            .unwrap_or(after_scheme.len());

        let url_chunk = &after_scheme[..url_boundary];

        if let Some(at_pos) = url_chunk.find('@') {
            let cred_part = &url_chunk[..at_pos];
            if !cred_part.is_empty() {
                // Есть credentials — маскируем
                let rest = &after_scheme[at_pos..];
                result.push_str("https://***");
                result.push_str(rest);
                remaining = "";
                break;
            }
        }

        // Нет credentials в этом URL — копируем как есть
        result.push_str("https://");
        remaining = after_scheme;
    }

    // Остаток строки без https://
    result.push_str(remaining);
    result
}
