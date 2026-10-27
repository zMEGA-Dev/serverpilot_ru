import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import {
  RefreshCw, Search, X, AlertTriangle, Play, Square,
  RotateCcw, Trash2, ScrollText, Info, ChevronDown,
  ChevronUp, PauseCircle, PlayCircle, Download, Box,
  HardDrive, Network, Package,
} from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import type {
  DockerInfo, DockerContainer, DockerContainerDetail,
  DockerImage, DockerVolume, DockerNetwork, DockerActionResult,
} from "../types";
import styles from "./DockerPage.module.css";

// ─── Утилиты ─────────────────────────────────────────

function stateColor(state: string): string {
  switch (state.toLowerCase()) {
    case "running":  return "var(--accent-green)";
    case "exited":   return "var(--text-muted)";
    case "paused":   return "var(--accent-yellow)";
    case "dead":     return "var(--accent-red)";
    case "created":  return "var(--accent-blue)";
    case "restarting": return "var(--accent-orange)";
    default:         return "var(--text-muted)";
  }
}

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    running: "Running", exited: "Stopped",
    paused: "Paused", dead: "Dead",
    created: "Created", restarting: "Restarting",
  };
  return map[state.toLowerCase()] ?? state;
}

function formatMb(mb: number): string {
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

// ─── Диалог подтверждения ─────────────────────────────

interface ConfirmProps {
  title: string;
  message: string;
  dangerous?: boolean;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
function ConfirmDialog({ title, message, dangerous, confirmText, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          {dangerous && <AlertTriangle size={16} style={{ color: "var(--accent-red)" }} />}
          {title}
        </div>
        <p className={`${styles.dialogMsg} ${dangerous ? styles.dangerText : ""}`}>
          {message}
        </p>
        <div className={styles.dialogActions}>
          <button className={styles.btnCancel} onClick={onCancel}>Отмена</button>
          <button className={dangerous ? styles.btnDelete : styles.btnConfirm} onClick={onConfirm}>
            {confirmText ?? "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Панель логов контейнера ─────────────────────────

interface ContainerLogsProps {
  serverId: string;
  container: DockerContainer;
  onClose: () => void;
}
function ContainerLogs({ serverId, container, onClose }: ContainerLogsProps) {
  const [lines, setLines] = useState(200);
  const [content, setContent] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const liveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await sshInvoke<string>("docker_container_logs", {
        serverId, containerId: container.id, lines,
      });
      setContent(raw.split("\n").filter((l) => l.trim()));
    } catch (err) {
      setContent([`Ошибка: ${err}`]);
    } finally {
      setLoading(false);
    }
  }, [serverId, container.id, lines]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (liveRef.current) clearInterval(liveRef.current);
    if (liveMode) liveRef.current = setInterval(fetchLogs, 3000);
    return () => { if (liveRef.current) clearInterval(liveRef.current); };
  }, [liveMode, fetchLogs]);

  const filtered = search.trim()
    ? content.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : content;

  function lineClass(l: string) {
    const low = l.toLowerCase();
    if (/error|exception|fatal|fail/.test(low)) return styles.lineError;
    if (/warn|warning/.test(low)) return styles.lineWarn;
    return "";
  }

  return (
    <div className={styles.logsPanel}>
      <div className={styles.logsHeader}>
        <span className={styles.logsTitle}><ScrollText size={14}/> Логи: {container.name}</span>
        <div className={styles.logsCtrl}>
          <select className={styles.linesSelect} value={lines}
            onChange={(e) => setLines(Number(e.target.value))}>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
          <button
            className={`${styles.liveBtn} ${liveMode ? styles.liveBtnOn : ""}`}
            onClick={() => setLiveMode((v) => !v)}
            title="Live tail"
          >
            <RefreshCw size={11} className={liveMode ? "animate-spin" : ""}/> Live
          </button>
          <button className={styles.logsRefresh} onClick={fetchLogs} disabled={loading}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""}/>
          </button>
          <button className={styles.logsClose} onClick={onClose}><X size={14}/></button>
        </div>
      </div>
      <div className={styles.logsSearch}>
        <Search size={11}/>
        <input className={styles.logsSearchInput} value={search}
          onChange={(e) => setSearch(e.target.value)} placeholder="Поиск..."/>
        {search && <span className={styles.logsCount}>{filtered.length}/{content.length}</span>}
        {liveMode && <span className={styles.liveIndicator}><span className="status-dot online"/> live</span>}
      </div>
      <div className={styles.logsBody}>
        {loading && <div className={styles.logsLoading}><span className="spinner"/> Загрузка...</div>}
        {!loading && filtered.length === 0 && <div className={styles.logsEmpty}>Логи пусты</div>}
        {!loading && filtered.map((l, i) => (
          <div key={i} className={`${styles.logLine} ${lineClass(l)}`}>
            <span className={styles.logNum}>{i + 1}</span>
            <span className={styles.logText}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Детали контейнера ───────────────────────────────

interface ContainerDetailProps {
  serverId: string;
  container: DockerContainer;
  onClose: () => void;
  onAction: (action: string) => void;
  onShowLogs: () => void;
}
function ContainerDetail({ serverId, container, onClose, onAction, onShowLogs }: ContainerDetailProps) {
  const [detail, setDetail] = useState<DockerContainerDetail | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    sshInvoke<DockerContainerDetail>("docker_container_detail", {
      serverId, containerId: container.id,
    }).then(setDetail).catch(() => setDetail(null));
  }, [container.id, serverId]);

  const handleAction = (action: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    onAction(action);
    // Сбрасываем loading после небольшой задержки — реальный сброс происходит после обновления списка
    setTimeout(() => setActionLoading(false), 2000);
  };

  const d = detail;
  const isRunning = container.state.toLowerCase() === "running";
  const isPaused = container.state.toLowerCase() === "paused";

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}><Box size={14}/> {container.name}</span>
        <button className={styles.detailClose} onClick={onClose}><X size={14}/></button>
      </div>

      <div className={styles.detailScroll}>
        <div className={styles.detailSection}>
          {([
            ["ID", container.short_id],
            ["Образ", container.image],
            ["Статус", stateLabel(container.state)],
            ["CPU", `${container.cpu_percent.toFixed(1)}%`],
            ["Память", `${formatMb(container.mem_mb)} / ${formatMb(container.mem_limit_mb)}`],
            ["Создан", container.created],
            ...(d ? [
              ["Запущен", d.started_at?.slice(0, 19)?.replace("T", " ") ?? "—"],
              ["Перезапуск", d.restart_policy || "no"],
              ["Команда", d.command || "—"],
              ["Entrypoint", d.entrypoint || "—"],
            ] : []),
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className={styles.detailRow}>
              <span className={styles.dk}>{k}</span>
              <span className={styles.dv}>{v}</span>
            </div>
          ))}
        </div>

        {container.ports && (
          <div className={styles.detailSection}>
            <div className={styles.sectionLabel}>Порты</div>
            <span className={styles.dvMono}>{container.ports || "—"}</span>
          </div>
        )}

        {d?.mounts && d.mounts.length > 0 && (
          <div className={styles.detailSection}>
            <div className={styles.sectionLabel}>Тома</div>
            {d.mounts.map((m, i) => (
              <div key={i} className={styles.mountRow}>
                <span className={styles.dvMono}>{m.source}</span>
                <span className={styles.mountArrow}>→</span>
                <span className={styles.dvMono}>{m.destination}</span>
                {m.mode && <span className={styles.mountMode}>{m.mode}</span>}
              </div>
            ))}
          </div>
        )}

        {d?.networks && d.networks.length > 0 && (
          <div className={styles.detailSection}>
            <div className={styles.sectionLabel}>Сети</div>
            {d.networks.map((n) => <div key={n} className={styles.dvMono}>{n}</div>)}
          </div>
        )}

        {d?.env && d.env.length > 0 && (
          <div className={styles.detailSection}>
            <div className={styles.sectionLabel}>
              Environment <span className={styles.envHint}>(секреты скрыты)</span>
            </div>
            <div className={styles.envTable}>
              {d.env.slice(0, 30).map(([k, v]) => (
                <div key={k} className={styles.envRow}>
                  <span className={styles.envKey}>{k}</span>
                  <span className={`${styles.envVal} ${v === "***" ? styles.envSecret : ""}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.actionBtn} onClick={onShowLogs} disabled={actionLoading}>
          <ScrollText size={12}/> Логи
        </button>
        {isRunning && <>
          <button className={styles.actionBtn} onClick={() => handleAction("restart")} disabled={actionLoading}>
            <RotateCcw size={12}/> Перезапустить
          </button>
          <button className={styles.actionBtn} onClick={() => handleAction("pause")} disabled={actionLoading}>
            <PauseCircle size={12}/> Пауза
          </button>
          <button className={styles.actionBtnWarn} onClick={() => handleAction("stop")} disabled={actionLoading}>
            <Square size={12}/> Остановить
          </button>
        </>}
        {isPaused && (
          <button className={styles.actionBtnGreen} onClick={() => handleAction("unpause")} disabled={actionLoading}>
            <PlayCircle size={12}/> Продолжить
          </button>
        )}
        {!isRunning && !isPaused && (
          <button className={styles.actionBtnGreen} onClick={() => handleAction("start")} disabled={actionLoading}>
            <Play size={12}/> Запустить
          </button>
        )}
        <button className={styles.actionBtnDanger} onClick={() => handleAction("remove")} disabled={actionLoading}>
          <Trash2 size={12}/> Удалить
        </button>
      </div>
    </div>
  );
}

// ─── Вкладки ─────────────────────────────────────────

type Tab = "containers" | "images" | "volumes" | "networks";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "containers", label: "Containers", icon: <Box size={13}/> },
  { key: "images",     label: "Images",     icon: <Package size={13}/> },
  { key: "volumes",    label: "Volumes",    icon: <HardDrive size={13}/> },
  { key: "networks",   label: "Networks",   icon: <Network size={13}/> },
];

// ─── Главная страница ─────────────────────────────────

export function DockerPage() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [info, setInfo] = useState<DockerInfo | null>(null);
  const [tab, setTab] = useState<Tab>("containers");

  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<DockerNetwork | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<DockerContainer | null>(null);
  const [logsContainer, setLogsContainer] = useState<DockerContainer | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; msg: string; dangerous?: boolean; action: () => void } | null>(null);
  const [pullForm, setPullForm] = useState(false);
  const [pullImage, setPullImage] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // ─ Определение Docker ─
  const detectDocker = useCallback(async () => {
    if (!selectedServerId || status !== "online") return;
    try {
      const d = await sshInvoke<DockerInfo>("docker_detect", { serverId: selectedServerId });
      setInfo(d);
    } catch {
      setInfo({ installed: false, version: "", daemon_running: false, has_permission: false, error: "" });
    }
  }, [selectedServerId, status]);

  // ─ Загрузка данных по вкладке ─
  const fetchTab = useCallback(async () => {
    if (!selectedServerId || status !== "online" || !info?.daemon_running) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "containers") {
        const list = await sshInvoke<DockerContainer[]>("docker_list_containers", { serverId: selectedServerId });
        setContainers(list);
      } else if (tab === "images") {
        const list = await sshInvoke<DockerImage[]>("docker_list_images", { serverId: selectedServerId });
        setImages(list);
      } else if (tab === "volumes") {
        const list = await sshInvoke<DockerVolume[]>("docker_list_volumes", { serverId: selectedServerId });
        setVolumes(list);
      } else if (tab === "networks") {
        const list = await sshInvoke<DockerNetwork[]>("docker_list_networks", { serverId: selectedServerId });
        setNetworks(list);
      }
    } catch (err) {
      setError(`Не удалось получить данные.\n\n${err}`);
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, status, info?.daemon_running, tab]);

  useEffect(() => {
    if (status === "online") detectDocker();
    else { setInfo(null); setContainers([]); }
  }, [selectedServerId, status]);

  useEffect(() => {
    if (info?.daemon_running) fetchTab();
  }, [tab, info]);

  // Авто-обновление
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh && info?.daemon_running) {
      timerRef.current = setInterval(fetchTab, 5000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchTab, info]);

  // ─ Действие над контейнером ─
  const doContainerAction = (action: string, container: DockerContainer) => {
    const labels: Record<string, string> = {
      start: "запустить", stop: "остановить", restart: "перезапустить",
      pause: "приостановить", unpause: "возобновить", remove: "удалить",
    };
    const dangerous = action === "remove";
    setConfirm({
      title: `${labels[action] ?? action} контейнер?`,
      msg: `Контейнер: ${container.name}\nОбраз: ${container.image}`,
      dangerous,
      action: async () => {
        setConfirm(null);
        try {
          const r = await sshInvoke<DockerActionResult>("docker_container_action", {
            serverId: selectedServerId!, action, containerId: container.id,
          });
          showStatus(r.message, r.success);
          if (r.success) {
            if (action === "remove" && selectedContainer?.id === container.id) setSelectedContainer(null);
            setTimeout(fetchTab, 800);
          } else { setError(r.message); }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ─ Pull образа ─
  const doPull = async () => {
    if (!pullImage.trim() || !selectedServerId) return;
    setPullForm(false);
    setLoading(true);
    try {
      const r = await sshInvoke<DockerActionResult>("docker_pull_image", {
        serverId: selectedServerId, image: pullImage.trim(),
      });
      showStatus(r.message, r.success);
      if (r.success) fetchTab();
      else setError(r.message);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); setPullImage(""); }
  };

  // ─ Удалить образ ─
  const doRemoveImage = (img: DockerImage) => {
    setConfirm({
      title: "Удалить образ?",
      msg: `${img.repository}:${img.tag}`,
      dangerous: true,
      action: async () => {
        setConfirm(null);
        try {
          const r = await sshInvoke<DockerActionResult>("docker_remove_image", {
            serverId: selectedServerId!, imageId: img.id,
          });
          showStatus(r.message, r.success);
          if (r.success) fetchTab();
          else setError(r.message);
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ─ Удалить том ─
  const doRemoveVolume = (vol: DockerVolume) => {
    setConfirm({
      title: "Удалить том?",
      msg: `${vol.name}\n\nДанные тома будут удалены безвозвратно.`,
      dangerous: true,
      action: async () => {
        setConfirm(null);
        try {
          const r = await sshInvoke<DockerActionResult>("docker_remove_volume", {
            serverId: selectedServerId!, name: vol.name,
          });
          showStatus(r.message, r.success);
          if (r.success) fetchTab();
          else setError(r.message);
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ─ Сеть ─
  const loadNetworkDetail = async (net: DockerNetwork) => {
    try {
      const detail = await sshInvoke<DockerNetwork>("docker_inspect_network", {
        serverId: selectedServerId!, networkId: net.id,
      });
      setSelectedNetwork(detail);
    } catch { setSelectedNetwork(net); }
  };

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Box size={40} style={{ opacity: 0.3 }}/>
        <p>{t("docker.detectHint")}</p>
      </div>
    );
  }

  if (info && !info.installed) {
    return (
      <div className={styles.notInstalled}>
        <Box size={48} style={{ opacity: 0.25 }}/>
        <h2>{t("docker.notInstalled")}</h2>
        <p>Docker allows running applications in isolated containers.</p>
        <button className={styles.refreshDetect} onClick={detectDocker}>
          <RefreshCw size={13}/> {t("app.refresh")}
        </button>
      </div>
    );
  }

  if (info && info.installed && !info.daemon_running) {
    return (
      <div className={styles.notInstalled}>
        <Box size={48} style={{ opacity: 0.25 }}/>
        <h2>{t("docker.daemonNotRunning")}</h2>
        <p className={styles.daemonError}>{info.error}</p>
        <button className={styles.refreshDetect} onClick={detectDocker}>
          <RefreshCw size={13}/> {t("app.refresh")}
        </button>
      </div>
    );
  }

  // ─── Фильтрация данных ──
  const q = search.toLowerCase();
  const filteredContainers = q
    ? containers.filter((c) => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.short_id.includes(q))
    : containers;
  const filteredImages = q
    ? images.filter((i) => `${i.repository}:${i.tag}`.toLowerCase().includes(q) || i.short_id.includes(q))
    : images;
  const filteredVolumes = q ? volumes.filter((v) => v.name.toLowerCase().includes(q)) : volumes;
  const filteredNetworks = q ? networks.filter((n) => n.name.toLowerCase().includes(q)) : networks;

  return (
    <div className={styles.page}>
      {/* Тулбар */}
      <div className={styles.toolbar}>
        <div className={styles.titleRow}>
          <h1>Docker</h1>
          {info?.version && <span className={styles.version}>v{info.version}</span>}
        </div>

        <div className={styles.searchBox}>
          <Search size={13} className={styles.searchIcon}/>
          <input className={styles.searchInput} value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."/>
          {search && <button className={styles.searchClear} onClick={() => setSearch("")}><X size={12}/></button>}
        </div>

        <div className={styles.toolbarRight}>
          <button
            className={`${styles.autoBtn} ${autoRefresh ? styles.autoBtnOn : ""}`}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <RefreshCw size={12} className={autoRefresh ? "animate-spin" : ""}/> Авто
          </button>
          <button className={styles.refreshBtn} onClick={fetchTab} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""}/>
          </button>
          {tab === "images" && (
            <button className={styles.pullBtn} onClick={() => setPullForm(true)}>
              <Download size={13}/> Загрузить образ
            </button>
          )}
        </div>
      </div>

      {/* Вкладки */}
      <div className={styles.tabs}>
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            className={`${styles.tabBtn} ${tab === key ? styles.tabBtnActive : ""}`}
            onClick={() => { setTab(key); setSelectedContainer(null); setLogsContainer(null); setSelectedNetwork(null); setSearch(""); }}
          >
            {icon} {label}
            {key === "containers" && containers.length > 0 && (
              <span className={styles.tabCount}>{containers.filter((c) => c.state === "running").length}/{containers.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Статус / Ошибка */}
      {statusMsg && (
        <div className={`${styles.statusBar} ${statusMsg.ok ? styles.statusOk : styles.statusErr}`}>
          {statusMsg.text}
        </div>
      )}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13}/>
          <pre className={styles.errorText}>{error}</pre>
          <button className={styles.errClose} onClick={() => setError(null)}><X size={12}/></button>
        </div>
      )}

      {/* Основная область */}
      <div className={styles.mainArea}>
        {/* Контент вкладки */}
        <div className={styles.tableWrap}>

          {/* ── КОНТЕЙНЕРЫ ── */}
          {tab === "containers" && (
            <>
              <div className={styles.thead}>
                <span className={styles.th} style={{width:28}}/>
                <span className={styles.th} style={{flex:1.5}}>Имя</span>
                <span className={styles.th} style={{flex:1.2}}>Образ</span>
                <span className={styles.th} style={{width:110}}>Статус</span>
                <span className={styles.th} style={{width:70}}>CPU</span>
                <span className={styles.th} style={{width:90}}>Память</span>
                <span className={styles.th} style={{flex:1}}>Порты</span>
                <span className={styles.th} style={{width:110}}>Действия</span>
              </div>
              <div className={styles.tbody}>
                {loading && filteredContainers.length === 0 && <div className={styles.loadingRow}><span className="spinner"/> Загрузка...</div>}
                {!loading && filteredContainers.length === 0 && <div className={styles.emptyRow}>{search ? "Ничего не найдено" : "Контейнеров нет"}</div>}
                {filteredContainers.map((c) => (
                  <div key={c.id}
                    className={`${styles.tr} ${selectedContainer?.id === c.id ? styles.trSelected : ""}`}
                    onClick={() => { setSelectedContainer((s) => s?.id === c.id ? null : c); setLogsContainer(null); }}
                  >
                    <span className={styles.td} style={{width:28}}>
                      <span className={styles.stateDot} style={{background: stateColor(c.state)}}/>
                    </span>
                    <span className={`${styles.td} ${styles.tdName}`} style={{flex:1.5}}>{c.name}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{flex:1.2}}>{c.image}</span>
                    <span className={styles.td} style={{width:110, color: stateColor(c.state), fontSize:12}}>{stateLabel(c.state)}</span>
                    <span className={`${styles.td} ${styles.tdNum}`} style={{width:70, color: c.cpu_percent > 50 ? "var(--accent-red)" : c.cpu_percent > 20 ? "var(--accent-yellow)" : "var(--text-secondary)"}}>{c.cpu_percent.toFixed(1)}%</span>
                    <span className={`${styles.td} ${styles.tdNum}`} style={{width:90}}>{formatMb(c.mem_mb)}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{flex:1, fontSize:11}}>{c.ports || "—"}</span>
                    <span className={styles.td} style={{width:110}} onClick={(e) => e.stopPropagation()}>
                      <div className={styles.quickBtns}>
                        <button className={styles.qb} title="Логи" onClick={() => { setLogsContainer(c); setSelectedContainer(null); }}><ScrollText size={12}/></button>
                        {c.state === "running"
                          ? <button className={styles.qb} title="Перезапустить" onClick={() => doContainerAction("restart", c)}><RotateCcw size={12}/></button>
                          : <button className={styles.qb} title="Запустить" onClick={() => doContainerAction("start", c)}><Play size={12}/></button>}
                        {c.state === "running" && <button className={`${styles.qb} ${styles.qbWarn}`} title="Остановить" onClick={() => doContainerAction("stop", c)}><Square size={12}/></button>}
                        <button className={`${styles.qb} ${styles.qbDanger}`} title="Удалить" onClick={() => doContainerAction("remove", c)}><Trash2 size={12}/></button>
                      </div>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── ОБРАЗЫ ── */}
          {tab === "images" && (
            <>
              <div className={styles.thead}>
                <span className={styles.th} style={{flex:2}}>Репозиторий</span>
                <span className={styles.th} style={{width:100}}>Тег</span>
                <span className={styles.th} style={{width:100}}>ID</span>
                <span className={styles.th} style={{width:120}}>Создан</span>
                <span className={styles.th} style={{width:80}}>Размер</span>
                <span className={styles.th} style={{width:90}}>Действия</span>
              </div>
              <div className={styles.tbody}>
                {loading && <div className={styles.loadingRow}><span className="spinner"/> Загрузка...</div>}
                {!loading && filteredImages.length === 0 && <div className={styles.emptyRow}>{search ? "Ничего не найдено" : "Образов нет"}</div>}
                {filteredImages.map((img) => (
                  <div key={img.id} className={styles.tr}>
                    <span className={`${styles.td} ${styles.tdName}`} style={{flex:2}}>{img.repository}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:100}}>{img.tag}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:100, color:"var(--text-muted)"}}>{img.short_id}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:120, fontSize:11}}>{img.created.slice(0,16)}</span>
                    <span className={`${styles.td} ${styles.tdNum}`} style={{width:80}}>{formatMb(img.size_mb)}</span>
                    <span className={styles.td} style={{width:90}}>
                      <button className={`${styles.qb} ${styles.qbDanger}`} title="Удалить" onClick={() => doRemoveImage(img)}><Trash2 size={12}/></button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── ТОМА ── */}
          {tab === "volumes" && (
            <>
              <div className={styles.thead}>
                <span className={styles.th} style={{flex:2}}>Имя</span>
                <span className={styles.th} style={{width:90}}>Драйвер</span>
                <span className={styles.th} style={{flex:2}}>Точка монтирования</span>
                <span className={styles.th} style={{width:80}}>Действия</span>
              </div>
              <div className={styles.tbody}>
                {loading && <div className={styles.loadingRow}><span className="spinner"/> Загрузка...</div>}
                {!loading && filteredVolumes.length === 0 && <div className={styles.emptyRow}>{search ? "Ничего не найдено" : "Томов нет"}</div>}
                {filteredVolumes.map((v) => (
                  <div key={v.name} className={styles.tr}>
                    <span className={`${styles.td} ${styles.tdName}`} style={{flex:2}}>{v.name}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:90}}>{v.driver}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{flex:2, fontSize:11}}>{v.mountpoint}</span>
                    <span className={styles.td} style={{width:80}}>
                      <button className={`${styles.qb} ${styles.qbDanger}`} title="Удалить" onClick={() => doRemoveVolume(v)}><Trash2 size={12}/></button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── СЕТИ ── */}
          {tab === "networks" && (
            <>
              <div className={styles.thead}>
                <span className={styles.th} style={{flex:2}}>Имя</span>
                <span className={styles.th} style={{width:100}}>Драйвер</span>
                <span className={styles.th} style={{width:80}}>Scope</span>
                <span className={styles.th} style={{width:80}}>ID</span>
              </div>
              <div className={styles.tbody}>
                {loading && <div className={styles.loadingRow}><span className="spinner"/> Загрузка...</div>}
                {!loading && filteredNetworks.length === 0 && <div className={styles.emptyRow}>{search ? "Ничего не найдено" : "Сетей нет"}</div>}
                {filteredNetworks.map((n) => (
                  <div key={n.id}
                    className={`${styles.tr} ${selectedNetwork?.id === n.id ? styles.trSelected : ""}`}
                    onClick={() => { setSelectedNetwork((s) => s?.id === n.id ? null : null); loadNetworkDetail(n); }}
                  >
                    <span className={`${styles.td} ${styles.tdName}`} style={{flex:2}}>{n.name}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:100}}>{n.driver}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:80}}>{n.scope}</span>
                    <span className={`${styles.td} ${styles.tdMono}`} style={{width:80, color:"var(--text-muted)"}}>{n.short_id}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className={styles.footer}>
            {tab === "containers" && <span>{filteredContainers.length} контейнеров · {filteredContainers.filter((c) => c.state === "running").length} запущено</span>}
            {tab === "images" && <span>{filteredImages.length} образов</span>}
            {tab === "volumes" && <span>{filteredVolumes.length} томов</span>}
            {tab === "networks" && <span>{filteredNetworks.length} сетей</span>}
          </div>
        </div>

        {/* Панель деталей контейнера */}
        {selectedContainer && !logsContainer && tab === "containers" && (
          <ContainerDetail
            serverId={selectedServerId!}
            container={selectedContainer}
            onClose={() => setSelectedContainer(null)}
            onAction={(action) => doContainerAction(action, selectedContainer)}
            onShowLogs={() => { setLogsContainer(selectedContainer); setSelectedContainer(null); }}
          />
        )}

        {/* Логи контейнера */}
        {logsContainer && tab === "containers" && (
          <ContainerLogs
            serverId={selectedServerId!}
            container={logsContainer}
            onClose={() => setLogsContainer(null)}
          />
        )}

        {/* Детали сети */}
        {selectedNetwork && tab === "networks" && (
          <div className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <span className={styles.detailTitle}><Network size={14}/> {selectedNetwork.name}</span>
              <button className={styles.detailClose} onClick={() => setSelectedNetwork(null)}><X size={14}/></button>
            </div>
            <div className={styles.detailScroll}>
              <div className={styles.detailSection}>
                {[
                  ["ID", selectedNetwork.short_id],
                  ["Драйвер", selectedNetwork.driver],
                  ["Scope", selectedNetwork.scope],
                  ["Subnet", selectedNetwork.subnet || "—"],
                  ["Gateway", selectedNetwork.gateway || "—"],
                ].map(([k, v]) => (
                  <div key={k} className={styles.detailRow}>
                    <span className={styles.dk}>{k}</span>
                    <span className={styles.dv}>{v}</span>
                  </div>
                ))}
              </div>
              {selectedNetwork.containers.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.sectionLabel}>Контейнеры</div>
                  {selectedNetwork.containers.map((c) => (
                    <div key={c} className={styles.dvMono}>{c}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Форма Pull образа */}
      {pullForm && (
        <div className={styles.overlay} onClick={() => setPullForm(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.dialogTitle}><Download size={15}/> Загрузить образ</div>
            <label className={styles.pullLabel}>Образ (repository:tag)</label>
            <input className={styles.pullInput} value={pullImage}
              onChange={(e) => setPullImage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doPull()}
              placeholder="nginx:latest" autoFocus/>
            <div className={styles.dialogActions}>
              <button className={styles.btnCancel} onClick={() => setPullForm(false)} disabled={loading}>Отмена</button>
              <button className={styles.btnConfirm} onClick={doPull} disabled={!pullImage.trim() || loading}>
                {loading ? <><span className="spinner" style={{width:12,height:12}}/> Загрузка...</> : "Загрузить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Диалог подтверждения */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.msg}
          dangerous={confirm.dangerous}
          confirmText={confirm.dangerous ? "Удалить" : "Подтвердить"}
          onConfirm={confirm.action}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
