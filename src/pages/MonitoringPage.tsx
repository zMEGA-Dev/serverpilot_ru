import React, { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { sshInvoke } from "../services/sshQueue";
import { RefreshCw, Activity } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, Legend
} from "recharts";
import { useServersStore } from "../stores/serversStore";
import type { ServerStats } from "../types";
import {
  loadNotificationSettings,
  checkThreshold,
} from "../services/notificationsService";
import styles from "./MonitoringPage.module.css";

interface DataPoint {
  time: string;
  cpu: number;
  ram: number;
  disk: number;
  load1: number;
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "#21262d", border: "1px solid #30363d", borderRadius: 6, fontSize: 11 }
};

export function MonitoringPage() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [history, setHistory] = useState<DataPoint[]>([]);
  const [latest, setLatest] = useState<ServerStats | null>(null);
  const [intervalSec, setIntervalSec] = useState(() => {
    const saved = localStorage.getItem("metrics_interval_sec");
    return saved ? Number(saved) : 5;
  });
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    if (!selectedServerId || status !== "online") return;
    try {
      const data = await sshInvoke<ServerStats>("get_server_stats", { serverId: selectedServerId });
      setLatest(data);
      const point: DataPoint = {
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        cpu: Math.round(data.cpu_usage),
        ram: Math.round(data.ram_usage_percent),
        disk: Math.round(data.disk_usage_percent),
        load1: data.load_avg_1,
      };
      setHistory((prev) => [...prev.slice(-719), point]);

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
    } catch {}
  }, [selectedServerId, status, t]);

  useEffect(() => {
    // Сбрасываем устаревшие данные при смене сервера
    setHistory([]);
    setLatest(null);
    if (status !== "online") return;
    setLoading(true);
    fetchStats().finally(() => setLoading(false));
    timerRef.current = setInterval(fetchStats, intervalSec * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [selectedServerId, status, intervalSec, fetchStats]);

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Activity size={40} style={{ opacity: 0.3 }} />
        <p>{t("monitoring.connectHint")}</p>
      </div>
    );
  }

  const xAxis = { tick: { fontSize: 9, fill: "#6e7681" }, interval: "preserveStartEnd" as const };
  const yAxisPct = { tick: { fontSize: 9, fill: "#6e7681" }, domain: [0, 100] as [number, number], width: 28 };
  const grid = { stroke: "rgba(255,255,255,0.04)", strokeDasharray: "3 3" };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>{t("monitoring.title")}</h1>
        <div className={styles.headerRight}>
          <label className={styles.intervalLabel}>
            {t("monitoring.interval")}:
            <select className={styles.select} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))}>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </label>
          <span className={styles.pointsLabel}>{history.length} {t("monitoring.points")}</span>
          <button className={styles.refreshBtn} onClick={fetchStats} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {latest && (
        <div className={styles.stats}>
          {[
            { label: t("monitoring.statCpu"),   value: latest.cpu_usage,          color: "var(--accent-blue)" },
            { label: t("monitoring.statRam"),   value: latest.ram_usage_percent,  color: "var(--accent-purple)" },
            { label: t("monitoring.statDisk"),  value: latest.disk_usage_percent, color: "var(--accent-cyan)" },
            { label: t("monitoring.statLoad"),  value: latest.load_avg_1,         color: "var(--accent-orange)", unit: "" },
          ].map(({ label, value, color, unit }) => (
            <div key={label} className={styles.statCard}>
              <span className={styles.statLabel}>{label}</span>
              <span className={styles.statValue} style={{ color }}>
                {value.toFixed(value > 10 ? 0 : 2)}{unit !== undefined ? unit : "%"}
              </span>
            </div>
          ))}
          <div className={styles.statCard}>
            <span className={styles.statLabel}>{t("monitoring.statMemMb")}</span>
            <span className={styles.statValue} style={{ color: "var(--accent-purple)", fontSize: 14 }}>
              {latest.ram_used_mb} / {latest.ram_total_mb}
            </span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>{t("monitoring.statLoad515")}</span>
            <span className={styles.statValue} style={{ color: "var(--accent-yellow)", fontSize: 14 }}>
              {latest.load_avg_5.toFixed(2)} / {latest.load_avg_15.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div className={styles.charts}>
          <div className={styles.chart}>
            <div className={styles.chartTitle}>{t("monitoring.cpuRamChart")}</div>
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={history} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="time" {...xAxis} />
                <YAxis {...yAxisPct} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v}%`, name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="cpu" stroke="var(--accent-blue)"
                  fill="rgba(79,142,247,0.1)" strokeWidth={1.5} dot={false} name={t("monitoring.cpuSeries")} />
                <Area type="monotone" dataKey="ram" stroke="var(--accent-purple)"
                  fill="rgba(188,140,255,0.1)" strokeWidth={1.5} dot={false} name={t("monitoring.ramSeries")} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className={styles.chart}>
            <div className={styles.chartTitle}>{t("monitoring.diskChart")}</div>
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={history} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="time" {...xAxis} />
                <YAxis {...yAxisPct} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, t("monitoring.diskTooltip")]} />
                <Area type="monotone" dataKey="disk" stroke="var(--accent-cyan)"
                  fill="rgba(57,197,207,0.1)" strokeWidth={1.5} dot={false} name={t("monitoring.diskTooltip")} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className={styles.chart}>
            <div className={styles.chartTitle}>{t("monitoring.loadChart")}</div>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={history} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="time" {...xAxis} />
                <YAxis tick={{ fontSize: 9, fill: "#6e7681" }} width={28} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(2), t("monitoring.loadTooltip")]} />
                <Line type="monotone" dataKey="load1" stroke="var(--accent-orange)"
                  dot={false} strokeWidth={1.5} name={t("monitoring.loadTooltip")} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {history.length <= 1 && !loading && (
        <div className={styles.waitingData}>
          <span className="spinner" />
          <span>{t("monitoring.collectingData")}</span>
        </div>
      )}
    </div>
  );
}
