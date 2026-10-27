import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import {
  RefreshCw, Search, X, Plus, Play, Square, RotateCcw,
  RefreshCwOff, Trash2, ScrollText, AlertTriangle, Info,
  ChevronDown, ChevronUp, ExternalLink, Package, Download,
} from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import type {
  Pm2App, Pm2AppDetail, Pm2DetectResult,
  Pm2ActionResult, Pm2StartRequest,
} from "../types";
import styles from "./Pm2Page.module.css";

// ─── Утилиты ─────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "online":    return "var(--accent-green)";
    case "stopped":   return "var(--text-muted)";
    case "errored":   return "var(--accent-red)";
    case "launching": return "var(--accent-yellow)";
    case "waiting":   return "var(--accent-yellow)";
    default:          return "var(--text-muted)";
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    online:    "Online",
    stopped:   "Stopped",
    errored:   "Errored",
    launching: "Launching",
    waiting:   "Waiting",
    stopping:  "Stopping",
  };
  return map[status] ?? status;
}

function formatMem(mb: number): string {
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

// ─── Диалог подтверждения действия ───────────────────

interface ActionDialogProps {
  app: Pm2App;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ActionDialog({ app, action, onConfirm, onCancel }: ActionDialogProps) {
  const isDelete = action === "delete";
  const labels: Record<string, string> = {
    restart: "Перезапустить",
    reload:  "Перезагрузить",
    stop:    "Остановить",
    start:   "Запустить",
    delete:  "Удалить",
  };
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          {isDelete && <AlertTriangle size={16} style={{ color: "var(--accent-red)" }} />}
          {labels[action] ?? action} приложение?
        </div>
        <div className={styles.dialogInfo}>
          <span className={styles.infoKey}>Приложение</span>
          <span className={styles.infoVal}>{app.name}</span>
          <span className={styles.infoKey}>PM2 ID</span>
          <span className={styles.infoVal}>{app.id}</span>
          <span className={styles.infoKey}>Статус</span>
          <span className={styles.infoVal} style={{ color: statusColor(app.status) }}>
            {statusLabel(app.status)}
          </span>
        </div>
        {isDelete && (
          <div className={styles.deleteWarning}>
            <AlertTriangle size={13} />
            Приложение будет удалено из PM2. Файлы на сервере не затронуты.
          </div>
        )}
        <div className={styles.dialogActions}>
          <button className={styles.btnCancel} onClick={onCancel}>Отмена</button>
          <button
            className={isDelete ? styles.btnDelete : styles.btnConfirm}
            onClick={onConfirm}
          >
            {labels[action] ?? "Выполнить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Панель деталей ───────────────────────────────────

interface DetailPanelProps {
  serverId: string;
  app: Pm2App;
  onClose: () => void;
  onAction: (action: string, app: Pm2App) => void;
  onShowLogs: (app: Pm2App) => void;
}

function DetailPanel({ serverId, app, onClose, onAction, onShowLogs }: DetailPanelProps) {
  const [detail, setDetail] = useState<Pm2AppDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<Pm2AppDetail>("pm2_detail", { serverId, appName: app.name })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [app.name, serverId]);

  const d = detail?.app ?? app;
  const env = detail?.env ?? [];

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>
          <Package size={14} /> {app.name}
        </span>
        <button className={styles.detailClose} onClick={onClose}><X size={14} /></button>
      </div>

      <div className={styles.detailScroll}>
        {/* Основные поля */}
        <div className={styles.detailSection}>
          {[
            ["PM2 ID", String(d.id)],
            ["PID", d.pid > 0 ? String(d.pid) : "—"],
            ["Статус", statusLabel(d.status)],
            ["CPU", `${d.cpu.toFixed(1)}%`],
            ["Память", formatMem(d.memory_mb)],
            ["Перезапуски", String(d.restarts)],
            ["Аптайм", d.uptime_str || "—"],
            ["Режим", d.mode],
            ["Node.js", d.node_version || "—"],
            ["Создан", d.created_at || "—"],
            ["Namespace", d.namespace || "default"],
          ].map(([k, v]) => (
            <div key={k} className={styles.detailRow}>
              <span className={styles.dk}>{k}</span>
              <span className={styles.dv}>{v}</span>
            </div>
          ))}
        </div>

        {/* Пути */}
        <div className={styles.detailSection}>
          <div className={styles.sectionLabel}>Пути</div>
          {[
            ["Скрипт", d.script],
            ["Рабочая директория", d.cwd],
            ["Аргументы", d.args || "—"],
            ["Лог (stdout)", d.pm_log_path || "—"],
            ["Лог (stderr)", d.pm_err_log_path || "—"],
          ].map(([k, v]) => (
            <div key={k} className={styles.detailRow}>
              <span className={styles.dk}>{k}</span>
              <span className={`${styles.dv} ${styles.dvMono}`}>{v}</span>
            </div>
          ))}
          {d.ecosystem_path && (
            <div className={styles.detailRow}>
              <span className={styles.dk}>Ecosystem</span>
              <span className={`${styles.dv} ${styles.dvMono}`}>{d.ecosystem_path}</span>
            </div>
          )}
        </div>

        {/* Env (только несекретные) */}
        {env.length > 0 && (
          <div className={styles.detailSection}>
            <div className={styles.sectionLabel}>
              Environment <span className={styles.envHint}>(секреты скрыты)</span>
            </div>
            <div className={styles.envTable}>
              {env.map(([k, v]) => (
                <div key={k} className={styles.envRow}>
                  <span className={styles.envKey}>{k}</span>
                  <span className={`${styles.envVal} ${v === "***" ? styles.envSecret : ""}`}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Кнопки действий */}
      <div className={styles.detailActions}>
        <button className={styles.actionBtn} onClick={() => onShowLogs(app)}>
          <ScrollText size={13} /> Логи
        </button>
        {d.status === "online" ? (
          <>
            <button className={styles.actionBtn} onClick={() => onAction("restart", app)}>
              <RotateCcw size={13} /> Перезапустить
            </button>
            <button className={styles.actionBtn} onClick={() => onAction("reload", app)}>
              <RefreshCwOff size={13} /> Перезагрузить
            </button>
            <button className={styles.actionBtnWarn} onClick={() => onAction("stop", app)}>
              <Square size={13} /> Остановить
            </button>
          </>
        ) : (
          <button className={styles.actionBtnGreen} onClick={() => onAction("start", app)}>
            <Play size={13} /> Запустить
          </button>
        )}
        <button className={styles.actionBtnDanger} onClick={() => onAction("delete", app)}>
          <Trash2 size={13} /> Удалить
        </button>
      </div>
    </div>
  );
}

// ─── Панель логов ─────────────────────────────────────

interface LogsPanelProps {
  serverId: string;
  app: Pm2App;
  onClose: () => void;
}

function LogsPanel({ serverId, app, onClose }: LogsPanelProps) {
  const [lines, setLines] = useState(200);
  const [content, setContent] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await sshInvoke<string>("pm2_logs", {
        serverId,
        appName: app.name,
        lines,
      });
      setContent(raw.split("\n").filter((l) => l.trim()));
    } catch (err) {
      setContent([`Ошибка получения логов: ${err}`]);
    } finally {
      setLoading(false);
    }
  }, [serverId, app.name, lines]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = search.trim()
    ? content.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : content;

  function classifyLine(line: string) {
    const l = line.toLowerCase();
    if (/error|exception|fatal|fail/.test(l)) return styles.lineError;
    if (/warn|warning/.test(l)) return styles.lineWarn;
    return "";
  }

  return (
    <div className={styles.logsPanel}>
      <div className={styles.logsHeader}>
        <span className={styles.logsTitle}>
          <ScrollText size={14} /> Логи: {app.name}
        </span>
        <div className={styles.logsControls}>
          <select
            className={styles.linesSelect}
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
          >
            <option value={100}>100 строк</option>
            <option value={200}>200 строк</option>
            <option value={500}>500 строк</option>
          </select>
          <button className={styles.logsRefresh} onClick={fetchLogs} disabled={loading}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button className={styles.logsClose} onClick={onClose}><X size={14} /></button>
        </div>
      </div>

      <div className={styles.logsSearch}>
        <Search size={12} />
        <input
          className={styles.logsSearchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по логам..."
        />
        {search && (
          <span className={styles.logsCount}>{filtered.length} / {content.length}</span>
        )}
      </div>

      <div className={styles.logsBody}>
        {loading && <div className={styles.logsLoading}><span className="spinner" /> Загрузка...</div>}
        {!loading && filtered.length === 0 && (
          <div className={styles.logsEmpty}>Логи пусты</div>
        )}
        {!loading && filtered.map((line, i) => (
          <div key={i} className={`${styles.logLine} ${classifyLine(line)}`}>
            <span className={styles.logNum}>{i + 1}</span>
            <span className={styles.logText}>{line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Форма запуска нового приложения ─────────────────

interface StartFormProps {
  serverId: string;
  onClose: () => void;
  onStarted: () => void;
}

function StartForm({ serverId, onClose, onStarted }: StartFormProps) {
  const [form, setForm] = useState<Pm2StartRequest>({
    name: "", script: "", cwd: "", interpreter: "node", args: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const upd = (k: keyof Pm2StartRequest, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.script.trim()) {
      setError("Заполните Название и Скрипт");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await sshInvoke<Pm2ActionResult>("pm2_start_new", {
        serverId,
        request: form,
      });
      if (result.success) {
        onStarted();
        onClose();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.startForm} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          <Plus size={15} /> Запустить приложение через PM2
        </div>

        <div className={styles.formFields}>
          <div className={styles.formField}>
            <label>Название *</label>
            <input className={styles.inp} value={form.name}
              onChange={(e) => upd("name", e.target.value)}
              placeholder="my-app" />
          </div>
          <div className={styles.formField}>
            <label>Скрипт / файл *</label>
            <input className={styles.inp} value={form.script}
              onChange={(e) => upd("script", e.target.value)}
              placeholder="/home/www/app/index.js" />
          </div>
          <div className={styles.formField}>
            <label>Рабочая директория</label>
            <input className={styles.inp} value={form.cwd}
              onChange={(e) => upd("cwd", e.target.value)}
              placeholder="/home/www/app" />
          </div>
          <div className={styles.formField}>
            <label>Интерпретатор</label>
            <select className={styles.inp} value={form.interpreter}
              onChange={(e) => upd("interpreter", e.target.value)}>
              <option value="node">node</option>
              <option value="python">python</option>
              <option value="python3">python3</option>
              <option value="bash">bash</option>
              <option value="">Авто</option>
            </select>
          </div>
          <div className={styles.formField}>
            <label>Аргументы</label>
            <input className={styles.inp} value={form.args}
              onChange={(e) => upd("args", e.target.value)}
              placeholder="--port 3000 --env production" />
          </div>
        </div>

        {error && <div className={styles.formError}>{error}</div>}

        <div className={styles.dialogActions}>
          <button className={styles.btnCancel} onClick={onClose}>Отмена</button>
          <button className={styles.btnConfirm} onClick={handleSubmit} disabled={loading}>
            {loading ? "Запуск..." : "Запустить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Основная страница ────────────────────────────────

type View = "list" | "detail" | "logs";

export function Pm2Page() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [detected, setDetected] = useState<Pm2DetectResult | null>(null);
  const [apps, setApps] = useState<Pm2App[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof Pm2App>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);

  const [selectedApp, setSelectedApp] = useState<Pm2App | null>(null);
  const [logsApp, setLogsApp] = useState<Pm2App | null>(null);
  const [actionTarget, setActionTarget] = useState<{ app: Pm2App; action: string } | null>(null);
  const [showStartForm, setShowStartForm] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // ─ Установить PM2 на сервер ─
  const handleInstall = async () => {
    if (!selectedServerId) return;
    setInstalling(true);
    setInstallLog(["Запуск установки PM2..."]);
    setError(null);

    // Шаги установки
    const steps = [
      { label: "Проверка npm...", cmd: "npm --version 2>&1" },
      { label: "Установка PM2 (npm install -g pm2)...", cmd: "npm install -g pm2 2>&1" },
      { label: "Проверка установки...", cmd: "pm2 --version 2>&1 || echo NOT_FOUND" },
    ];

    let allOk = true;
    for (const step of steps) {
      setInstallLog((prev) => [...prev, `\n▶ ${step.label}`]);
      try {
        const result = await invoke<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }>(
          "execute_command",
          { serverId: selectedServerId, command: step.cmd }
        );
        const out = (result.stdout + result.stderr).trim();
        if (out) setInstallLog((prev) => [...prev, out]);
        if (result.exit_code !== 0 && step.cmd.includes("npm install")) {
          setInstallLog((prev) => [...prev, "❌ Ошибка установки"]);
          allOk = false;
          break;
        }
      } catch (err) {
        setInstallLog((prev) => [...prev, `❌ Ошибка: ${err}`]);
        allOk = false;
        break;
      }
    }

    if (allOk) {
      setInstallLog((prev) => [...prev, "\n✅ PM2 успешно установлен!"]);
      // Перепроверяем через секунду
      setTimeout(() => detect().then(() => fetchApps()), 1200);
    }
    setInstalling(false);
  };

  // ─ Обнаружение PM2 ─
  const detect = useCallback(async () => {
    if (!selectedServerId || status !== "online") return;
    try {
      const d = await sshInvoke<Pm2DetectResult>("pm2_detect", { serverId: selectedServerId });
      setDetected(d);
    } catch {
      setDetected({ installed: false, version: "", error: "Не удалось проверить PM2" });
    }
  }, [selectedServerId, status]);

  // ─ Загрузить список ─
  const fetchApps = useCallback(async () => {
    if (!selectedServerId || status !== "online") return;
    setLoading(true);
    setError(null);
    try {
      const list = await sshInvoke<Pm2App[]>("pm2_list", { serverId: selectedServerId });
      setApps(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, status]);

  useEffect(() => {
    if (status === "online") {
      detect().then(() => fetchApps());
    } else {
      setDetected(null);
      setApps([]);
    }
  }, [selectedServerId, status]);

  // Авто-обновление
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh && status === "online" && detected?.installed) {
      timerRef.current = setInterval(fetchApps, refreshInterval * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshInterval, fetchApps, status, detected]);

  // ─ Сортировка / фильтрация ─
  const displayed = useMemo(() => {
    let list = apps;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) ||
               a.script.toLowerCase().includes(q) ||
               String(a.id).includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      const diff = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? diff : -diff;
    });
  }, [apps, search, sortKey, sortDir]);

  const handleSort = (key: keyof Pm2App) => {
    if (key === sortKey) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ─ Выполнить действие ─
  const execAction = async (action: string, app: Pm2App) => {
    setActionTarget(null);
    if (!selectedServerId) return;
    try {
      const result = await sshInvoke<Pm2ActionResult>("pm2_action", {
        serverId: selectedServerId,
        action,
        appName: app.name,
      });
      showStatus(result.message, result.success);
      if (result.success) {
        if (action === "delete" && selectedApp?.name === app.name) setSelectedApp(null);
        setTimeout(fetchApps, 1000);
      } else {
        setError(
          `Не удалось выполнить действие.\n\nPM2:\n${result.raw_output || result.message}`
        );
      }
    } catch (err) {
      setError(String(err));
    }
  };

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Package size={40} style={{ opacity: 0.3 }} />
        <p>{t("pm2.detectHint")}</p>
      </div>
    );
  }

  if (detected && !detected.installed) {
    return (
      <div className={styles.notInstalled}>
        <Package size={48} style={{ opacity: 0.25 }} />
        <h2>{t("pm2.notInstalled")}</h2>
        <p>PM2 is a process manager for Node.js applications.</p>

        {/* Кнопка автоустановки */}
        {!installing && installLog.length === 0 && (
          <>
            <button className={styles.installBtn} onClick={handleInstall}>
              <Download size={14} /> Установить PM2 на сервер
            </button>
            <p className={styles.installHint}>
              Выполнит <code>npm install -g pm2</code> на удалённом сервере
            </p>
          </>
        )}

        {/* Прогресс установки */}
        {(installing || installLog.length > 0) && (
          <div className={styles.installLog}>
            <div className={styles.installLogHeader}>
              {installing && <span className="spinner" style={{width:12,height:12}} />}
              {installing ? "Установка PM2..." : "Результат установки"}
            </div>
            <pre className={styles.installLogBody}>
              {installLog.join("\n")}
              {installing && <span className={styles.cursor}>_</span>}
            </pre>
            {!installing && (
              <div className={styles.installLogFooter}>
                <button className={styles.refreshDetect}
                  onClick={() => { setInstallLog([]); detect().then(() => fetchApps()); }}>
                  <RefreshCw size={13} /> Проверить снова
                </button>
                {!installLog.some((l) => l.includes("✅")) && (
                  <button className={styles.installBtn} onClick={() => { setInstallLog([]); handleInstall(); }}>
                    <Download size={13} /> Повторить
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!installing && installLog.length === 0 && (
          <button className={styles.refreshDetect}
            onClick={() => detect().then(() => fetchApps())}>
            <RefreshCw size={13} /> Проверить снова
          </button>
        )}

        {detected.error && (
          <p className={styles.detectError}>Детали: {detected.error}</p>
        )}
      </div>
    );
  }

  const SortBtn = ({ col, label }: { col: keyof Pm2App; label: string }) => (
    <button
      className={`${styles.th} ${sortKey === col ? styles.thActive : ""}`}
      onClick={() => handleSort(col)}
    >
      {label}
      {sortKey === col
        ? sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
        : <ChevronUp size={11} style={{ opacity: 0.2 }} />}
    </button>
  );

  return (
    <div className={styles.page}>
      {/* Тулбар */}
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <h1>PM2</h1>
          {detected?.version && (
            <span className={styles.version}>v{detected.version}</span>
          )}
        </div>

        <div className={styles.searchBox}>
          <Search size={13} className={styles.searchIcon} />
          <input className={styles.searchInput} value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по приложениям..." />
          {search && <button className={styles.searchClear} onClick={() => setSearch("")}><X size={12} /></button>}
        </div>

        <div className={styles.toolbarRight}>
          {/* Авто-обновление */}
          <button
            className={`${styles.autoBtn} ${autoRefresh ? styles.autoBtnOn : ""}`}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""} />
            Авто
          </button>
          {autoRefresh && (
            <select className={styles.intervalSel} value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}>
              <option value={3}>3с</option>
              <option value={5}>5с</option>
              <option value={10}>10с</option>
            </select>
          )}
          <button className={styles.refreshBtn} onClick={fetchApps} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button className={styles.newAppBtn} onClick={() => setShowStartForm(true)}>
            <Plus size={13} /> Запустить приложение
          </button>
        </div>
      </div>

      {/* Статус / Ошибка */}
      {statusMsg && (
        <div className={`${styles.statusBar} ${statusMsg.ok ? styles.statusOk : styles.statusErr}`}>
          {statusMsg.text}
        </div>
      )}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} />
          <pre className={styles.errorText}>{error}</pre>
          <button className={styles.errClose} onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Основная область */}
      <div className={styles.mainArea}>
        {/* Таблица */}
        <div className={styles.tableWrap}>
          <div className={styles.thead}>
            <SortBtn col="id" label="ID" />
            <SortBtn col="name" label="Приложение" />
            <SortBtn col="status" label="Статус" />
            <SortBtn col="cpu" label="CPU" />
            <SortBtn col="memory_mb" label="Память" />
            <SortBtn col="restarts" label="Рестарты" />
            <SortBtn col="uptime_str" label="Аптайм" />
            <span className={styles.thActions}>Действия</span>
          </div>

          <div className={styles.tbody}>
            {loading && apps.length === 0 && (
              <div className={styles.loadingRow}><span className="spinner" /> Загрузка...</div>
            )}
            {!loading && displayed.length === 0 && (
              <div className={styles.emptyRow}>
                {search ? "Ничего не найдено" : "Нет приложений в PM2"}
              </div>
            )}

            {displayed.map((app) => (
              <div
                key={app.id}
                className={`${styles.tr} ${selectedApp?.name === app.name ? styles.trSelected : ""}`}
                onClick={() => setSelectedApp((s) => s?.name === app.name ? null : app)}
              >
                <span className={styles.tdId}>{app.id}</span>
                <span className={styles.tdName}>
                  {app.name}
                  {app.mode === "cluster" && (
                    <span className={styles.clusterBadge}>{app.instances}x</span>
                  )}
                </span>
                <span className={styles.tdStatus}>
                  <span className={styles.statusDot} style={{ background: statusColor(app.status) }} />
                  <span style={{ color: statusColor(app.status) }}>{statusLabel(app.status)}</span>
                </span>
                <span className={styles.tdNum} style={{
                  color: app.cpu > 50 ? "var(--accent-red)" : app.cpu > 20 ? "var(--accent-yellow)" : "var(--text-secondary)"
                }}>
                  {app.cpu.toFixed(1)}%
                </span>
                <span className={styles.tdNum}>{formatMem(app.memory_mb)}</span>
                <span className={styles.tdNum}>{app.restarts}</span>
                <span className={styles.tdNum}>{app.uptime_str || "—"}</span>

                {/* Быстрые действия */}
                <span className={styles.tdActions} onClick={(e) => e.stopPropagation()}>
                  <button className={styles.quickBtn} title="Логи"
                    onClick={() => setLogsApp(app)}>
                    <ScrollText size={12} />
                  </button>
                  {app.status === "online" ? (
                    <button className={styles.quickBtn} title="Перезапустить"
                      onClick={() => setActionTarget({ app, action: "restart" })}>
                      <RotateCcw size={12} />
                    </button>
                  ) : (
                    <button className={styles.quickBtn} title="Запустить"
                      onClick={() => setActionTarget({ app, action: "start" })}>
                      <Play size={12} />
                    </button>
                  )}
                  {app.status === "online" && (
                    <button className={`${styles.quickBtn} ${styles.quickWarn}`} title="Остановить"
                      onClick={() => setActionTarget({ app, action: "stop" })}>
                      <Square size={12} />
                    </button>
                  )}
                  <button className={`${styles.quickBtn} ${styles.quickDanger}`} title="Удалить"
                    onClick={() => setActionTarget({ app, action: "delete" })}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>

          {/* Нижняя строка */}
          <div className={styles.footer}>
            <span>{displayed.length}{search ? ` / ${apps.length}` : ""} приложений</span>
            <span className={styles.footerHint}>Клик — детали · Кнопки — быстрые действия</span>
          </div>
        </div>

        {/* Панель деталей */}
        {selectedApp && !logsApp && (
          <DetailPanel
            serverId={selectedServerId!}
            app={selectedApp}
            onClose={() => setSelectedApp(null)}
            onAction={(action, app) => setActionTarget({ app, action })}
            onShowLogs={(app) => { setLogsApp(app); }}
          />
        )}

        {/* Логи */}
        {logsApp && (
          <LogsPanel
            serverId={selectedServerId!}
            app={logsApp}
            onClose={() => setLogsApp(null)}
          />
        )}
      </div>

      {/* Диалог подтверждения */}
      {actionTarget && (
        <ActionDialog
          app={actionTarget.app}
          action={actionTarget.action}
          onConfirm={() => execAction(actionTarget.action, actionTarget.app)}
          onCancel={() => setActionTarget(null)}
        />
      )}

      {/* Форма запуска */}
      {showStartForm && (
        <StartForm
          serverId={selectedServerId!}
          onClose={() => setShowStartForm(false)}
          onStarted={() => { showStatus("Приложение запущено"); fetchApps(); }}
        />
      )}
    </div>
  );
}
