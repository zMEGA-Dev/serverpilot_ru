import React, { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import { Cpu, HardDrive, Wifi, Clock, AlertCircle, RefreshCw, Plug } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";
import { useServersStore } from "../stores/serversStore";
import type { ServerStats } from "../types";
import {
  loadNotificationSettings,
  notifyServerOffline,
  resetServerOfflineCooldown,
  checkThreshold,
} from "../services/notificationsService";
import styles from "./DashboardPage.module.css";

interface HistPoint {
  time: string;
  cpu: number;
  ram: number;
  disk: number;
  rx: number;
  tx: number;
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B/s";
  if (b < 1024) return `${b} B/s`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1048576).toFixed(1)} MB/s`;
}

interface GaugeProps {
  label: string;
  value: number;
  unit: string;
  sub?: string;
  color: string;
  icon: React.ReactNode;
}
function Gauge({ label, value, unit, sub, color, icon }: GaugeProps) {
  const barColor = value > 90 ? "var(--accent-red)" : value > 75 ? "var(--accent-yellow)" : color;
  const textColor = value > 90 ? "var(--accent-red)" : value > 75 ? "var(--accent-yellow)" : "var(--text-primary)";
  return (
    <div className={styles.gauge}>
      <div className={styles.gaugeTop}>
        <span style={{ color, display: "flex", alignItems: "center" }}>{icon}</span>
        <span className={styles.gaugeLabel}>{label}</span>
        <span className={styles.gaugeVal} style={{ color: textColor }}>
          {typeof value === "number" ? value.toFixed(value >= 10 ? 0 : 1) : "—"}{unit}
        </span>
      </div>
      <div className={styles.bar}>
        <div className={styles.barFill} style={{ width: `${Math.min(100, value)}%`, background: barColor }} />
      </div>
      {sub && <p className={styles.gaugeSub}>{sub}</p>}
    </div>
  );
}

const CHART_CFG = {
  cartesian: { stroke: "rgba(255,255,255,0.05)", strokeDasharray: "3 3" },
  xAxis: { tick: { fontSize: 9, fill: "#6e7681" }, interval: "preserveStartEnd" as const },
  yAxis: { tick: { fontSize: 9, fill: "#6e7681" }, domain: [0, 100] as [number, number], width: 28 },
  tooltip: { contentStyle: { background: "#21262d", border: "1px solid #30363d", borderRadius: 6, fontSize: 11 } },
};

export function DashboardPage() {
  const { t } = useTranslation();
  const { getSelectedServer, selectedServerId, connectionStatus, setConnectionStatus } = useServersStore();
  const server = getSelectedServer();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [stats, setStats] = useState<ServerStats | null>(null);
  const [history, setHistory] = useState<HistPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevNetRef = useRef({ rx: 0, tx: 0 });
  const prevStatusRef = useRef<string | undefined>(undefined);
  const prevServerIdRef = useRef<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!selectedServerId) return;
    try {
      const data = await sshInvoke<ServerStats>("get_server_stats", { serverId: selectedServerId });
      const rxSpeed = data.network_rx_bytes > prevNetRef.current.rx
        ? data.network_rx_bytes - prevNetRef.current.rx : 0;
      const txSpeed = data.network_tx_bytes > prevNetRef.current.tx
        ? data.network_tx_bytes - prevNetRef.current.tx : 0;
      prevNetRef.current = { rx: data.network_rx_bytes, tx: data.network_tx_bytes };
      setStats(data);
      setError(null);
      const point: HistPoint = {
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        cpu: Math.round(data.cpu_usage),
        ram: Math.round(data.ram_usage_percent),
        disk: Math.round(data.disk_usage_percent),
        rx: rxSpeed,
        tx: txSpeed,
      };
      setHistory((prev) => [...prev.slice(-59), point]);
      // Threshold notifications — same as MonitoringPage
      const ns = loadNotificationSettings();
      const serverLabel = data.hostname || selectedServerId;
      await checkThreshold({
        serverId: selectedServerId,
        serverName: serverLabel,
        metricKey: "cpu",
        value: data.cpu_usage,
        threshold: ns.cpuThreshold,
        enabled: ns.cpuHigh,
        globalEnabled: ns.enabled,
        metricLabel: "CPU",
        hint: t("monitoring.openMonitoring"),
      });
      await checkThreshold({
        serverId: selectedServerId,
        serverName: serverLabel,
        metricKey: "ram",
        value: data.ram_usage_percent,
        threshold: ns.ramThreshold,
        enabled: ns.ramHigh,
        globalEnabled: ns.enabled,
        metricLabel: "RAM",
        hint: t("monitoring.openMonitoring"),
      });
      await checkThreshold({
        serverId: selectedServerId,
        serverName: serverLabel,
        metricKey: "disk",
        value: data.disk_usage_percent,
        threshold: ns.diskThreshold,
        enabled: ns.diskHigh,
        globalEnabled: ns.enabled,
        metricLabel: "Disk",
        hint: t("monitoring.openMonitoring"),
      });
    } catch (err) {
      setError(String(err));
    }
  }, [selectedServerId]);

  const handleConnect = async () => {
    if (!selectedServerId) return;
    setConnectionStatus(selectedServerId, "connecting");
    setError(null);
    try {
      await sshInvoke("connect_ssh", { serverId: selectedServerId });
      setConnectionStatus(selectedServerId, "online");
    } catch (err) {
      setConnectionStatus(selectedServerId, "error");
      setError(String(err));
    }
  };

  useEffect(() => {
    if (!selectedServerId || !server) {
      prevStatusRef.current = status;
      return;
    }
    const prev = prevStatusRef.current;
    const curr = status;
    if (prev === "online" && (curr === "offline" || curr === "error")) {
      const ns = loadNotificationSettings();
      notifyServerOffline({ serverId: selectedServerId, serverName: server.name, settings: ns });
    }
    if (curr === "online" && prev !== "online") {
      resetServerOfflineCooldown(selectedServerId);
    }
    prevStatusRef.current = curr;
  }, [status, selectedServerId, server]);

  useEffect(() => {
    // Сброс статистики при смене сервера (включая online → online)
    if (prevServerIdRef.current !== selectedServerId) {
      prevServerIdRef.current = selectedServerId;
      setStats(null);
      setHistory([]);
      prevNetRef.current = { rx: 0, tx: 0 };
    }
    if (!selectedServerId || status !== "online") {
      setStats(null);
      setHistory([]);
      prevNetRef.current = { rx: 0, tx: 0 };
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    setLoading(true);
    fetchStats().finally(() => setLoading(false));
    intervalRef.current = setInterval(fetchStats, 10000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [selectedServerId, status, fetchStats]);

  function formatUptime(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}${t("dashboard.days")} ${h}${t("dashboard.hours")}`;
    if (h > 0) return `${h}${t("dashboard.hours")} ${m}${t("dashboard.minutes")}`;
    return `${m}${t("dashboard.minutes")}`;
  }

  if (!server) {
    return (
      <div className={styles.empty}>
        <AlertCircle size={40} className={styles.emptyIcon} />
        <h2>{t("dashboard.selectServer")}</h2>
        <p>{t("dashboard.selectServerHint")}</p>
      </div>
    );
  }

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyBox}>
          <h2>{server.name}</h2>
          <p className={styles.emptyHost}>{server.username}@{server.host}:{server.port}</p>
          {error && <div className={styles.errorMsg}>{error}</div>}
          <button
            className={styles.connectBtn}
            onClick={handleConnect}
            disabled={status === "connecting"}
          >
            {status === "connecting" ? (
              <><span className="spinner" style={{width:14,height:14}}/> {t("app.connecting")}</>
            ) : (
              <><Plug size={14}/> {t("app.connect")}</>
            )}
          </button>
          <p className={styles.emptyHint}>{t("dashboard.noConnection")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.serverHeader}>
        <div className={styles.serverTitle}>
          <span className="status-dot online" />
          <h1 style={{ color: server.color }}>{server.name}</h1>
          {stats?.os_name && <span className={styles.osTag}>{stats.os_name}</span>}
          {stats?.hostname && <span className={styles.hostTag}>{stats.hostname}</span>}
        </div>
        <div className={styles.headerRight}>
          {stats && (
            <span className={styles.uptime}>
              <Clock size={12} /> {formatUptime(stats.uptime_seconds)}
            </span>
          )}
          <button className={styles.refreshBtn} onClick={fetchStats} disabled={loading} title={t("app.refresh")}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      )}

      {loading && !stats && (
        <div className={styles.loadingState}><span className="spinner" /> {t("dashboard.gettingMetrics")}</div>
      )}

      {stats && (
        <>
          <div className={styles.gaugesGrid}>
            <Gauge
              label={t("dashboard.cpu")}
              value={stats.cpu_usage}
              unit="%"
              icon={<Cpu size={15}/>}
              color="var(--accent-blue)"
              sub={`${t("dashboard.loadLabel")}: ${stats.load_avg_1.toFixed(2)} / ${stats.load_avg_5.toFixed(2)} / ${stats.load_avg_15.toFixed(2)}`}
            />
            <Gauge
              label={t("dashboard.ram")}
              value={stats.ram_usage_percent}
              unit="%"
              icon={<span style={{fontSize:15}}>⬡</span>}
              color="var(--accent-purple)"
              sub={`${stats.ram_used_mb} MB / ${stats.ram_total_mb} MB`}
            />
            <Gauge
              label={t("dashboard.disk")}
              value={stats.disk_usage_percent}
              unit="%"
              icon={<HardDrive size={15}/>}
              color="var(--accent-cyan)"
              sub={`${stats.disk_used_gb.toFixed(1)} GB / ${stats.disk_total_gb.toFixed(1)} GB`}
            />
            <div className={styles.gauge}>
              <div className={styles.gaugeTop}>
                <span style={{ color: "var(--accent-green)", display: "flex" }}><Wifi size={15}/></span>
                <span className={styles.gaugeLabel}>{t("dashboard.network")}</span>
              </div>
              <div className={styles.netRow}>
                <span>{t("dashboard.netUp")} {formatBytes(history[history.length - 1]?.tx ?? 0)}</span>
                <span>{t("dashboard.netDown")} {formatBytes(history[history.length - 1]?.rx ?? 0)}</span>
              </div>
              <p className={styles.gaugeSub}>
                {t("dashboard.kernelLabel")}: {stats.kernel_version || "—"}
              </p>
            </div>
          </div>

          {history.length > 1 && (
            <div className={styles.chartsGrid}>
              <div className={styles.chart}>
                <div className={styles.chartTitle}>{t("dashboard.cpuPct")}</div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={history} margin={{top:4,right:4,left:-16,bottom:0}}>
                    <CartesianGrid {...CHART_CFG.cartesian}/>
                    <XAxis dataKey="time" {...CHART_CFG.xAxis}/>
                    <YAxis {...CHART_CFG.yAxis}/>
                    <Tooltip {...CHART_CFG.tooltip} formatter={(v: number) => [`${v}%`, t("dashboard.cpuTooltip")]}/>
                    <Line type="monotone" dataKey="cpu" stroke="var(--accent-blue)" dot={false} strokeWidth={1.5} name={t("dashboard.cpuTooltip")}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chart}>
                <div className={styles.chartTitle}>{t("dashboard.ramPct")}</div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={history} margin={{top:4,right:4,left:-16,bottom:0}}>
                    <CartesianGrid {...CHART_CFG.cartesian}/>
                    <XAxis dataKey="time" {...CHART_CFG.xAxis}/>
                    <YAxis {...CHART_CFG.yAxis}/>
                    <Tooltip {...CHART_CFG.tooltip} formatter={(v: number) => [`${v}%`, t("dashboard.ramTooltip")]}/>
                    <Line type="monotone" dataKey="ram" stroke="var(--accent-purple)" dot={false} strokeWidth={1.5} name={t("dashboard.ramTooltip")}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chart}>
                <div className={styles.chartTitle}>{t("dashboard.diskPct")}</div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={history} margin={{top:4,right:4,left:-16,bottom:0}}>
                    <CartesianGrid {...CHART_CFG.cartesian}/>
                    <XAxis dataKey="time" {...CHART_CFG.xAxis}/>
                    <YAxis {...CHART_CFG.yAxis}/>
                    <Tooltip {...CHART_CFG.tooltip} formatter={(v: number) => [`${v}%`, t("dashboard.diskTooltip")]}/>
                    <Line type="monotone" dataKey="disk" stroke="var(--accent-cyan)" dot={false} strokeWidth={1.5} name={t("dashboard.diskTooltip")}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className={styles.sysInfo}>
            <div className={styles.sysGrid}>
              {([
                [t("dashboard.sysInfoOs"),       stats.os_name],
                [t("dashboard.sysInfoKernel"),    stats.kernel_version],
                [t("dashboard.sysInfoHostname"),  stats.hostname],
                [t("dashboard.sysInfoHost"),      server.host],
                [t("dashboard.sysInfoUser"),      server.username],
                [t("dashboard.sysInfoUptime"),    formatUptime(stats.uptime_seconds)],
              ] as [string, string | undefined][]).map(([k, v]) => (
                <div key={k} className={styles.sysItem}>
                  <span className={styles.sysKey}>{k}</span>
                  <span className={styles.sysVal}>{v || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
