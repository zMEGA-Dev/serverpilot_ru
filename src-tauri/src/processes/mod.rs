use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub user: String,
    pub cpu: f64,
    pub mem: f64,
    pub vsz_kb: u64,
    pub rss_kb: u64,
    pub state: String,
    pub state_label: String,
    pub started: String,
    pub time: String,
    pub command: String,
    pub exe: String,
}

/// Команда получения списка процессов.
/// Использует только /proc + встроенные Unix-утилиты (ps), без python3.
/// Формат вывода: строго разделённые поля через \x01 (SOH) — безопасно для команд с пробелами.
pub const LIST_COMMAND: &str =
    "ps -eo pid,ppid,user:20,pcpu,pmem,vsz,rss,stat,lstart,time,comm,args \
     --sort=-pcpu --no-headers 2>/dev/null \
     | awk 'BEGIN{OFS=\"\\x01\"} {
         pid=$1; ppid=$2; user=$3; cpu=$4; mem=$5; vsz=$6; rss=$7; stat=$8;
         # lstart занимает 5 полей (DDD MMM DD HH:MM:SS YYYY)
         started=$9\" \"$10\" \"$11\" \"$12\" \"$13;
         ctime=$14;
         comm=$15;
         args=\"\"; for(i=16;i<=NF;i++) args=args\" \"$i; gsub(/^ /,\"\",args);
         if(args==\"\") args=comm;
         print pid,ppid,user,cpu,mem,vsz,rss,stat,started,ctime,comm,args
     }' | head -200";

/// Команда для получения деталей одного процесса по PID.
/// PID передаётся как число — validated на Rust стороне.
pub fn detail_command(pid: u32) -> String {
    format!(
        "ps -p {pid} -o pid,ppid,user:30,pcpu,pmem,vsz,rss,stat,lstart,time,comm,args \
         --no-headers 2>/dev/null \
         | awk 'BEGIN{{OFS=\"\\x01\"}} {{
             pid=$1; ppid=$2; user=$3; cpu=$4; mem=$5; vsz=$6; rss=$7; stat=$8;
             started=$9\" \"$10\" \"$11\" \"$12\" \"$13;
             ctime=$14; comm=$15;
             args=\"\"; for(i=16;i<=NF;i++) args=args\" \"$i; gsub(/^ /,\"\",args);
             if(args==\"\") args=comm;
             print pid,ppid,user,cpu,mem,vsz,rss,stat,started,ctime,comm,args
         }}'",
        pid = pid
    )
}

/// Расшифровать код состояния процесса.
pub fn state_label(code: &str) -> &'static str {
    let c = code.chars().next().unwrap_or(' ');
    match c {
        'R' => "Выполняется",
        'S' => "Ожидание",
        'D' => "Ожидание I/O",
        'Z' => "Зомби",
        'T' => "Остановлен",
        'I' => "Простой",
        't' => "Трассировка",
        'W' => "Подкачка",
        'X' => "Завершён",
        _ => "Неизвестно",
    }
}

/// Безопасная команда SIGTERM (terminate) для PID.
/// PID валидируется как u32 — инъекция невозможна.
pub fn kill_term_command(pid: u32) -> String {
    format!("kill -SIGTERM {}", pid)
}

/// Безопасная команда SIGKILL для PID.
pub fn kill_kill_command(pid: u32) -> String {
    format!("kill -SIGKILL {}", pid)
}

/// Список PID, которые нельзя завершать.
/// PID 1 (init/systemd), PID 0 (scheduler).
pub fn is_protected_pid(pid: u32) -> bool {
    pid <= 1
}

/// Список команд, завершение которых опасно.
#[allow(dead_code)]
pub fn is_critical_process(command: &str) -> bool {
    let cmd = command.to_lowercase();
    let cmd = cmd.trim_start_matches('/');
    let exe = cmd.split('/').last().unwrap_or(cmd);
    let critical = [
        "systemd", "init", "kernel", "kthread", "kworker",
        "sshd",    // Убьём sshd — потеряем соединение
        "sudo", "su",
    ];
    critical.iter().any(|c| exe.starts_with(c))
}

/// Парсить одну строку вывода ps (разделитель \x01).
pub fn parse_line(line: &str) -> Option<ProcessInfo> {
    let parts: Vec<&str> = line.splitn(12, '\x01').collect();
    if parts.len() < 12 {
        return None;
    }

    let pid: u32 = parts[0].trim().parse().ok()?;
    let ppid: u32 = parts[1].trim().parse().unwrap_or(0);
    let user = parts[2].trim().to_string();
    let cpu: f64 = parts[3].trim().parse().unwrap_or(0.0);
    let mem: f64 = parts[4].trim().parse().unwrap_or(0.0);
    let vsz_kb: u64 = parts[5].trim().parse().unwrap_or(0);
    let rss_kb: u64 = parts[6].trim().parse().unwrap_or(0);
    let state_code = parts[7].trim().to_string();
    let started = parts[8].trim().to_string();
    let time = parts[9].trim().to_string();
    let exe = parts[10].trim().to_string();
    let command = parts[11].trim().to_string();

    let state_label = state_label(&state_code).to_string();

    Some(ProcessInfo {
        pid,
        ppid,
        user,
        cpu,
        mem,
        vsz_kb,
        rss_kb,
        state: state_code,
        state_label,
        started,
        time,
        command,
        exe,
    })
}

/// Парсить весь вывод команды ps.
pub fn parse_output(output: &str) -> Vec<ProcessInfo> {
    output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(parse_line)
        .collect()
}
