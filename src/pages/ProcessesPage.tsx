import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import {
  RefreshCw, Search, X, ChevronUp, ChevronDown,
  Activity, AlertTriangle, Info, Cpu,
} from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import type { ProcessInfo, KillResult, ProcessSortKey, SortDir } from "../types";
import styles from "./ProcessesPage.module.css";

function formatMem(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1048576) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1048576).toFixed(2)} GB`;
}

function stateColor(state: string): string {
  const c = state.charAt(0).toUpperCase();
  if (c === "R") return "var(--accent-green)";
  if (c === "D") return "var(--accent-red)";
  if (c === "Z") return "var(--accent-orange)";
  if (c === "T") return "var(--accent-yellow)";
  return "var(--text-muted)";
}

const PROTECTED_PIDS = new Set([0, 1]);
const CRITICAL_EXES = new Set(["systemd", "init", "sshd", "kthread", "kworker", "sudo", "su"]);

function isProtected(proc: ProcessInfo): boolean {
  return PROTECTED_PIDS.has(proc.pid) || CRITICAL_EXES.has(proc.exe.split("/").pop() ?? proc.exe);
}

function isSshd(proc: ProcessInfo): boolean {
  return proc.exe.includes("sshd") || proc.command.includes("sshd");
}

interface KillDialogProps {
  proc: ProcessInfo;
  force: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
function KillDialog({ proc, force, onConfirm, onCancel }: KillDialogProps) {
  const { t } = useTranslation();
  const signal = force ? "SIGKILL" : "SIGTERM";
  const danger = force || isSshd(proc);

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.killDialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.killTitle}>
          <AlertTriangle size={16} style={{ color: danger ? "var(--accent-red)" : "var(--accent-yellow)" }} />
          {force ? t("processes.killForce") : t("processes.kill")}
        </div>
        <div className={styles.killInfo}>
          {[
            [t("processes.pid"),     String(proc.pid)],
            [t("processes.command"), proc.command],
            [t("processes.user"),    proc.user],
            ["Signal",               signal],
          ].map(([k, v]) => (
            <div key={k} className={styles.killRow}>
              <span className={styles.killKey}>{k}</span>
              <span className={styles.killVal} style={k === "Signal" ? { color: danger ? "var(--accent-red)" : "var(--accent-yellow)" } : undefined}>{v}</span>
            </div>
          ))}
        </div>
        <p className={styles.killWarning}>
          {force
            ? "SIGKILL immediately terminates the process without saving data."
            : "This may stop an application or service."}
        </p>
        {isSshd(proc) && (
          <div className={styles.killDanger}>
            <AlertTriangle size={13} />
            {t("processes.sshWarning")}
          </div>
        )}
        <div className={styles.killActions}>
          <button className={styles.btnCancel} onClick={onCancel}>{t("app.cancel")}</button>
          <button className={force ? styles.btnKill : styles.btnTerm} onClick={onConfirm}>
            {force ? t("processes.killForce") : t("processes.kill")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DetailPanelProps {
  proc: ProcessInfo;
  onClose: () => void;
  onKill: (force: boolean) => void;
}
function DetailPanel({ proc, onClose, onKill }: DetailPanelProps) {
  const { t } = useTranslation();
  const protected_ = isProtected(proc);

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>
          <Info size={14} /> {t("processes.detail")} PID {proc.pid}
        </span>
        <button className={styles.detailClose} onClick={onClose}><X size={14} /></button>
      </div>
      <div className={styles.detailGrid}>
        {([
          ["PID",      String(proc.pid)],
          ["PPID",     String(proc.ppid)],
          [t("processes.user"),    proc.user],
          [t("processes.state"),   `${proc.state_label} (${proc.state})`],
          [t("processes.cpu"),     `${proc.cpu.toFixed(1)}%`],
          [t("processes.ram"),     `${proc.mem.toFixed(1)}%`],
          ["RSS",      formatMem(proc.rss_kb)],
          ["VSZ",      formatMem(proc.vsz_kb)],
          ["Started",  proc.started],
          ["CPU time", proc.time],
          ["Exe",      proc.exe],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className={styles.detailRow}>
            <span className={styles.detailKey}>{k}</span>
            <span className={styles.detailVal}>{v}</span>
          </div>
        ))}
        <div className={styles.detailRow} style={{ gridColumn: "1 / -1" }}>
          <span className={styles.detailKey}>{t("processes.command")}</span>
          <span className={`${styles.detailVal} ${styles.detailCmd}`}>{proc.command}</span>
        </div>
      </div>
      {protected_ && (
        <div className={styles.protectedBanner}>
          <AlertTriangle size={13} />
          {t("processes.protectedProcess")}
        </div>
      )}
      {!protected_ && (
        <div className={styles.detailActions}>
          <button className={styles.btnTerm} onClick={() => onKill(false)}>
            {t("processes.kill")}
          </button>
          <button className={styles.btnKill} onClick={() => onKill(true)}>
            {t("processes.killForce")}
          </button>
        </div>
      )}
    </div>
  );
}

function SortIcon({ col, current, dir }: { col: ProcessSortKey; current: ProcessSortKey; dir: SortDir }) {
  if (col !== current) return <ChevronUp size={11} style={{ opacity: 0.2 }} />;
  return dir === "asc"
    ? <ChevronUp size={11} style={{ color: "var(--accent-blue)" }} />
    : <ChevronDown size={11} style={{ color: "var(--accent-blue)" }} />;
}

export function ProcessesPage() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<ProcessSortKey>("cpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<ProcessInfo | null>(null);
  const [killTarget, setKillTarget] = useState<{ proc: ProcessInfo; force: boolean } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const fetchProcesses = useCallback(async () => {
    if (!selectedServerId || status !== "online") return;
    setLoading(true);
    setError(null);
    try {
      const list = await sshInvoke<ProcessInfo[]>("get_processes", { serverId: selectedServerId });
      setProcesses(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, status]);

  useEffect(() => {
    if (status === "online") fetchProcesses();
    else setProcesses([]);
  }, [selectedServerId, status]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh && status === "online") {
      timerRef.current = setInterval(fetchProcesses, refreshInterval * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshInterval, fetchProcesses, status]);

  const displayed = useMemo(() => {
    let list = processes;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.command.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.exe.toLowerCase().includes(q) ||
        String(p.pid).includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case "pid":     diff = a.pid - b.pid; break;
        case "user":    diff = a.user.localeCompare(b.user); break;
        case "cpu":     diff = a.cpu - b.cpu; break;
        case "mem":     diff = a.mem - b.mem; break;
        case "state":   diff = a.state.localeCompare(b.state); break;
        case "command": diff = a.exe.localeCompare(b.exe); break;
      }
      return sortDir === "asc" ? diff : -diff;
    });
    return list;
  }, [processes, search, sortKey, sortDir]);

  const handleSort = (key: ProcessSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const handleKillConfirm = async () => {
    if (!killTarget || !selectedServerId) return;
    const { proc, force } = killTarget;
    setKillTarget(null);
    try {
      const result = await invoke<KillResult>(
        force ? "kill_process_force" : "kill_process",
        { serverId: selectedServerId, pid: proc.pid }
      );
      showStatus(result.message, result.success);
      if (result.success) {
        if (selected?.pid === proc.pid) setSelected(null);
        setTimeout(fetchProcesses, 1000);
      }
    } catch (err) {
      showStatus(String(err), false);
    }
  };

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Activity size={40} style={{ opacity: 0.3 }} />
        <p>{t("processes.connectHint")}</p>
      </div>
    );
  }

  const COLUMNS: { key: ProcessSortKey; label: string; w: string }[] = [
    { key: "pid",     label: t("processes.pid"),     w: "70px" },
    { key: "user",    label: t("processes.user"),    w: "110px" },
    { key: "cpu",     label: t("processes.cpu"),     w: "70px" },
    { key: "mem",     label: t("processes.ram"),     w: "70px" },
    { key: "state",   label: t("processes.state"),   w: "110px" },
    { key: "command", label: t("processes.command"), w: "1fr" },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{t("processes.title")}</h1>
        <div className={styles.searchBox}>
          <Search size={13} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("app.search")}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </div>
        <div className={styles.autoRefresh}>
          <button
            className={`${styles.autoBtn} ${autoRefresh ? styles.autoBtnOn : ""}`}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""} />
            {t("processes.autoRefresh")}
          </button>
          {autoRefresh && (
            <select
              className={styles.intervalSelect}
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
            >
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          )}
        </div>
        <button className={styles.refreshBtn} onClick={fetchProcesses} disabled={loading} title={t("app.refresh")}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <span className={styles.counter}>
          {displayed.length}{search ? ` / ${processes.length}` : ""} {t("processes.title").toLowerCase()}
        </span>
      </div>

      {statusMsg && (
        <div className={`${styles.statusBar} ${statusMsg.ok ? styles.statusOk : styles.statusErr}`}>
          {statusMsg.text}
        </div>
      )}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} /> {error}
          <button className={styles.errClose} onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      <div className={styles.mainArea}>
        <div className={styles.tableWrap}>
          <div className={styles.thead}>
            {COLUMNS.map(({ key, label, w }) => (
              <button
                key={key}
                className={`${styles.th} ${sortKey === key ? styles.thActive : ""}`}
                style={{ width: w, minWidth: w === "1fr" ? 0 : w }}
                onClick={() => handleSort(key)}
              >
                {label}
                <SortIcon col={key} current={sortKey} dir={sortDir} />
              </button>
            ))}
          </div>
          <div className={styles.tbody}>
            {loading && processes.length === 0 && (
              <div className={styles.loadingRow}>
                <span className="spinner" /> {t("processes.loading")}
              </div>
            )}
            {!loading && displayed.length === 0 && (
              <div className={styles.emptyRow}>
                {search ? t("app.search") + ": 0" : t("processes.noProcesses")}
              </div>
            )}
            {displayed.map((proc) => (
              <div
                key={proc.pid}
                className={`${styles.tr} ${selected?.pid === proc.pid ? styles.trSelected : ""} ${isProtected(proc) ? styles.trProtected : ""}`}
                onClick={() => setSelected((s) => s?.pid === proc.pid ? null : proc)}
              >
                <span className={styles.td} style={{ width: 70, minWidth: 70, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{proc.pid}</span>
                <span className={styles.td} style={{ width: 110, minWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proc.user}</span>
                <span className={styles.td} style={{ width: 70, minWidth: 70, fontFamily: "var(--font-mono)", color: proc.cpu > 50 ? "var(--accent-red)" : proc.cpu > 20 ? "var(--accent-yellow)" : "var(--text-secondary)" }}>{proc.cpu.toFixed(1)}%</span>
                <span className={styles.td} style={{ width: 70, minWidth: 70, fontFamily: "var(--font-mono)", color: proc.mem > 20 ? "var(--accent-yellow)" : "var(--text-secondary)" }}>{proc.mem.toFixed(1)}%</span>
                <span className={styles.td} style={{ width: 110, minWidth: 110 }}>
                  <span className={styles.stateChip} style={{ color: stateColor(proc.state) }}>
                    <span className={styles.stateDot} style={{ background: stateColor(proc.state) }} />
                    {proc.state_label}
                  </span>
                </span>
                <span className={`${styles.td} ${styles.tdCmd}`} style={{ minWidth: 0 }}>
                  <span className={styles.cmdExe}>{proc.exe.split("/").pop() || proc.exe}</span>
                  {proc.command !== proc.exe && (
                    <span className={styles.cmdArgs}> {proc.command.replace(proc.exe, "").trim()}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {selected && (
          <DetailPanel
            proc={selected}
            onClose={() => setSelected(null)}
            onKill={(force) => setKillTarget({ proc: selected, force })}
          />
        )}
      </div>

      {killTarget && (
        <KillDialog
          proc={killTarget.proc}
          force={killTarget.force}
          onConfirm={handleKillConfirm}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </div>
  );
}
