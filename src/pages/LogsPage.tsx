import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import { ScrollText, Search, RefreshCw, Zap, ZapOff, Download } from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import styles from "./LogsPage.module.css";

const LOG_PATHS = [
  { label: "syslog",        path: "/var/log/syslog" },
  { label: "auth.log",      path: "/var/log/auth.log" },
  { label: "kern.log",      path: "/var/log/kern.log" },
  { label: "nginx access",  path: "/var/log/nginx/access.log" },
  { label: "nginx error",   path: "/var/log/nginx/error.log" },
  { label: "apache2 error", path: "/var/log/apache2/error.log" },
  { label: "mysql error",   path: "/var/log/mysql/error.log" },
  { label: "dmesg",         path: "/var/log/dmesg" },
  { label: "dpkg.log",      path: "/var/log/dpkg.log" },
  { label: "journald",      path: "" },
];

function classifyLine(line: string): "error" | "warn" | "info" | "normal" {
  const l = line.toLowerCase();
  if (/error|crit|emerg|fatal|failed|fail\b|denied/.test(l)) return "error";
  if (/warn|warning|notice/.test(l)) return "warn";
  if (/info|debug|start|stop|restart|reloaded/.test(l)) return "info";
  return "normal";
}

export function LogsPage() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [selectedLog, setSelectedLog] = useState(LOG_PATHS[0]);
  const [lines, setLines] = useState(300);
  const [content, setContent] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [liveTail, setLiveTail] = useState(false);

  const liveTailRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLog = useCallback(async (append = false) => {
    if (!selectedServerId || status !== "online") return;
    setLoading(true);
    setError("");
    try {
      const cmd = selectedLog.path === ""
        ? `journalctl -n ${lines} --no-pager 2>/dev/null || echo "journalctl unavailable"`
        : `tail -n ${lines} "${selectedLog.path}" 2>/dev/null || echo "File unavailable: ${selectedLog.path}"`;

      const result = await invoke<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }>(
        "execute_command", { serverId: selectedServerId, command: cmd }
      );

      const newLines = result.stdout.split("\n").filter((l) => l.trim().length > 0);

      if (append) {
        setContent((prev) => {
          const lastPrev = prev[prev.length - 1] ?? "";
          const startIdx = newLines.findIndex((l) => l === lastPrev);
          return startIdx >= 0
            ? [...prev, ...newLines.slice(startIdx + 1)]
            : [...prev.slice(-500), ...newLines];
        });
      } else {
        setContent(newLines);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, status, selectedLog, lines]);

  useEffect(() => {
    if (liveTail) {
      fetchLog();
      liveTailRef.current = setInterval(() => fetchLog(true), 3000);
    } else {
      if (liveTailRef.current) clearInterval(liveTailRef.current);
    }
    return () => { if (liveTailRef.current) clearInterval(liveTailRef.current); };
  }, [liveTail, fetchLog]);

  useEffect(() => {
    if (liveTail) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content, liveTail]);

  const handleLogChange = (path: string) => {
    setLiveTail(false);
    setContent([]);
    setSearch("");
    setSelectedLog(LOG_PATHS.find((l) => l.path === path) ?? LOG_PATHS[0]);
  };

  useEffect(() => {
    if (status === "online") fetchLog();
  }, [selectedLog]);

  const downloadLog = () => {
    const blob = new Blob([content.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selectedLog.label.replace(/\s+/g, "_")}.log`;
    a.click();
  };

  const filtered = search.trim()
    ? content.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : content;

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <ScrollText size={40} style={{ opacity: 0.3 }} />
        <p>{t("logs.connectHint")}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1>{t("logs.title")}</h1>
        <div className={styles.toolbarRight}>
          <select className={styles.select} value={selectedLog.path} onChange={(e) => handleLogChange(e.target.value)}>
            {LOG_PATHS.map((l) => (
              <option key={l.path + l.label} value={l.path}>{l.label}</option>
            ))}
          </select>

          <select className={styles.select} value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            <option value={100}>100 {t("logs.lines")}</option>
            <option value={300}>300 {t("logs.lines")}</option>
            <option value={500}>500 {t("logs.lines")}</option>
            <option value={1000}>1000 {t("logs.lines")}</option>
          </select>

          <button
            className={`${styles.btn} ${liveTail ? styles.btnActive : ""}`}
            onClick={() => setLiveTail((v) => !v)}
            title={t("logs.liveTail")}
          >
            {liveTail ? <ZapOff size={13}/> : <Zap size={13}/>}
            {liveTail ? "Stop" : t("logs.liveActive")}
          </button>

          <button
            className={styles.btn}
            onClick={() => { setLiveTail(false); fetchLog(); }}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""}/>
            {t("app.refresh")}
          </button>

          {content.length > 0 && (
            <button className={styles.btn} onClick={downloadLog} title={t("logs.download")}>
              <Download size={13}/>
            </button>
          )}
        </div>
      </div>

      <div className={styles.searchBar}>
        <Search size={13} className={styles.searchIcon}/>
        <input
          className={styles.searchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("logs.search")}
        />
        {search && content.length > 0 && (
          <span className={styles.matchCount}>
            {filtered.length} / {content.length}
          </span>
        )}
        {content.length > 0 && !search && (
          <span className={styles.matchCount}>{content.length} {t("logs.lines")}</span>
        )}
        {liveTail && (
          <span className={styles.liveIndicator}>
            <span className="status-dot online"/> {t("logs.liveActive")}
          </span>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.logView}>
        {content.length === 0 && !loading ? (
          <div className={styles.noContent}>{t("logs.noLogs")}</div>
        ) : (
          filtered.map((line, i) => {
            const cls = classifyLine(line);
            return (
              <div key={i} className={`${styles.logLine} ${styles["line_" + cls]}`}>
                <span className={styles.lineNum}>{i + 1}</span>
                <span className={styles.lineText}>
                  {search ? highlightSearch(line, search) : line}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function highlightSearch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "rgba(210,153,34,0.35)", color: "inherit", borderRadius: 2 }}>{part}</mark>
      : part
  );
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
