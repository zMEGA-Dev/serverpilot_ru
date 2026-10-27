import type { CommandRisk } from "../types";

/**
 * Классифицирует риск SSH-команды по её тексту.
 * read_only — безопасные команды чтения.
 * low — незначительное влияние.
 * medium — изменения конфигурации.
 * high — удаление/остановка сервисов.
 * critical — необратимые действия с данными.
 */
export function classifyRisk(cmd: string): CommandRisk {
  const c = cmd.trim().toLowerCase();
  if (/^(rm\s+-rf|rm\s+-fr|mkfs|dd\s+if|wipefs|shred)/.test(c)) return "critical";
  if (/^(rm\s+|rmdir|pkill|kill\s+-9|reboot|shutdown|init\s+0)/.test(c)) return "high";
  if (/^(systemctl\s+(restart|stop|start|reload)|apt|yum|dnf|pip\s+install|npm\s+install)/.test(c)) return "medium";
  if (/^(cat|ls|df|du|top|ps|free|uname|hostname|uptime|who|netstat|ss|ip\s+|ping|curl|wget|tail|head|grep|find|systemctl\s+status|journalctl|docker\s+(ps|stats|logs|inspect)|pm2\s+(list|status|logs))/.test(c)) return "read_only";
  return "low";
}
