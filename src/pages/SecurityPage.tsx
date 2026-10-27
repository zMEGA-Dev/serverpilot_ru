import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Shield, CheckCircle, XCircle, AlertTriangle, HelpCircle,
  RefreshCw, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { sshInvoke } from "../services/sshQueue";
import { useServersStore } from "../stores/serversStore";
import type { AuditResult, SecurityCheck, CheckStatus } from "../types";
import styles from "./SecurityPage.module.css";

function statusIcon(s: CheckStatus, size = 15) {
  switch (s) {
    case "pass":     return <CheckCircle   size={size} style={{ color: "var(--accent-green)" }} />;
    case "warning":  return <AlertTriangle size={size} style={{ color: "var(--accent-yellow)" }} />;
    case "critical": return <XCircle       size={size} style={{ color: "var(--accent-red)" }} />;
    case "info":     return <Info          size={size} style={{ color: "var(--accent-blue)" }} />;
    case "unknown":  return <HelpCircle    size={size} style={{ color: "var(--text-muted)" }} />;
  }
}

function statusLabel(s: CheckStatus): string {
  return s.toUpperCase();
}

function statusClass(s: CheckStatus): string {
  switch (s) {
    case "pass":     return styles.statusPass;
    case "warning":  return styles.statusWarn;
    case "critical": return styles.statusCrit;
    case "info":     return styles.statusInfo;
    case "unknown":  return styles.statusUnk;
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--accent-green)";
  if (score >= 60) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

interface CheckCardProps {
  check: SecurityCheck;
  stepStatus?: "pending" | "running" | "done";
}

function CheckCard({ check, stepStatus }: CheckCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (stepStatus === "pending") {
    return (
      <div className={`${styles.checkCard} ${styles.checkPending}`}>
        <div className={styles.checkHeader}>
          <span className={styles.stepCircle} />
          <span className={styles.checkTitle}>{check.title}</span>
          <span className={styles.checkCat}>{check.category}</span>
        </div>
      </div>
    );
  }

  if (stepStatus === "running") {
    return (
      <div className={`${styles.checkCard} ${styles.checkRunning}`}>
        <div className={styles.checkHeader}>
          <span className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span className={styles.checkTitle}>{check.title}</span>
          <span className={styles.checkCat}>{check.category}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.checkCard} ${statusClass(check.status)}`}>
      <button className={styles.checkHeader} onClick={() => setExpanded(v => !v)}>
        {statusIcon(check.status, 14)}
        <span className={styles.checkTitle}>{check.title}</span>
        <span className={styles.checkCat}>{check.category}</span>
        <span className={`${styles.statusBadge} ${statusClass(check.status)}_badge`}>
          {statusLabel(check.status)}
        </span>
        {expanded ? <ChevronUp size={13} className={styles.chevron} /> : <ChevronDown size={13} className={styles.chevron} />}
      </button>

      {expanded && (
        <div className={styles.checkBody}>
          <div className={styles.currentVal}>
            <span className={styles.fieldLabel}>Current state:</span>
            <code className={styles.fieldVal}>{check.current_value}</code>
          </div>
          {check.description && (
            <div className={styles.checkDesc}>{check.description}</div>
          )}
          {check.recommendation && check.status !== "pass" && (
            <div className={styles.recommendation}>
              <span className={styles.recLabel}>Recommendation:</span>
              <pre className={styles.recVal}>{check.recommendation}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  const { t } = useTranslation();

  const scoreLabel =
    score >= 80 ? "Good" :
    score >= 60 ? "Needs attention" :
    "Critical";

  return (
    <div className={styles.scoreGauge}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--bg-hover)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="40" fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
        <text x="50" y="46" textAnchor="middle" fill={color} fontSize="18" fontWeight="700">{score}</text>
        <text x="50" y="60" textAnchor="middle" fill="var(--text-muted)" fontSize="9">/ 100</text>
      </svg>
      <div className={styles.scoreLabel} style={{ color }}>{scoreLabel}</div>
    </div>
  );
}

export function SecurityPage() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [result, setResult]     = useState<AuditResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [error, setError]       = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<CheckStatus | "all">("all");

  const SCAN_STEPS = [
    { id: "connect", title: t("security.scanStep1") },
    { id: "config",  title: t("security.scanStep2") },
    { id: "ports",   title: t("security.scanStep3") },
    { id: "report",  title: t("security.scanStep4") },
  ];

  const startAudit = async () => {
    if (!selectedServerId) return;
    setScanning(true);
    setResult(null);
    setError(null);
    setCurrentStep(0);

    const stepDelay = (ms: number) => new Promise(r => setTimeout(r, ms));
    const auditPromise = sshInvoke<AuditResult>("run_security_audit", { serverId: selectedServerId });

    for (let i = 0; i < SCAN_STEPS.length; i++) {
      setCurrentStep(i);
      await stepDelay(600);
    }

    try {
      const data = await auditPromise;
      setResult(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
      setCurrentStep(-1);
    }
  };

  const filteredChecks = result?.checks.filter(c =>
    filterStatus === "all" || c.status === filterStatus
  ) ?? [];

  const byCategory: Record<string, SecurityCheck[]> = {};
  for (const check of filteredChecks) {
    if (!byCategory[check.category]) byCategory[check.category] = [];
    byCategory[check.category].push(check);
  }

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Shield size={40} style={{ opacity: 0.3 }} />
        <p>{t("security.connectHint")}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1><Shield size={18} /> {t("security.title")}</h1>
        <button className={styles.scanBtn} onClick={startAudit} disabled={scanning}>
          {scanning
            ? <><RefreshCw size={14} className="animate-spin" /> {t("security.running")}</>
            : <><Shield size={14} /> {t("security.run")}</>
          }
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {scanning && (
        <div className={styles.scanProgress}>
          <div className={styles.scanProgressTitle}>{t("security.scanning")}</div>
          <div className={styles.scanSteps}>
            {SCAN_STEPS.map((step, idx) => (
              <div key={step.id} className={`${styles.scanStep} ${
                idx < currentStep ? styles.scanStepDone :
                idx === currentStep ? styles.scanStepActive :
                styles.scanStepPending
              }`}>
                {idx < currentStep
                  ? <CheckCircle size={13} style={{ color: "var(--accent-green)" }} />
                  : idx === currentStep
                  ? <span className="spinner" style={{ width: 12, height: 12 }} />
                  : <span className={styles.stepCircle} />
                }
                <span>{step.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && !scanning && (
        <>
          <div className={styles.summary}>
            <ScoreGauge score={result.score} />
            <div className={styles.summaryStats}>
              <div className={styles.statItem}>
                <CheckCircle size={16} style={{ color: "var(--accent-green)" }} />
                <span className={styles.statNum}>{result.pass_count}</span>
                <span className={styles.statLabel}>{t("security.passed")}</span>
              </div>
              <div className={styles.statItem}>
                <AlertTriangle size={16} style={{ color: "var(--accent-yellow)" }} />
                <span className={styles.statNum}>{result.warning_count}</span>
                <span className={styles.statLabel}>{t("security.warnings")}</span>
              </div>
              <div className={styles.statItem}>
                <XCircle size={16} style={{ color: "var(--accent-red)" }} />
                <span className={styles.statNum}>{result.critical_count}</span>
                <span className={styles.statLabel}>{t("security.critical")}</span>
              </div>
              {result.unknown_count > 0 && (
                <div className={styles.statItem}>
                  <HelpCircle size={16} style={{ color: "var(--text-muted)" }} />
                  <span className={styles.statNum}>{result.unknown_count}</span>
                  <span className={styles.statLabel}>{t("app.unknown")}</span>
                </div>
              )}
            </div>
            <div className={styles.summaryMeta}>
              <span>Checked: {result.checks.length}</span>
              <button className={styles.rescanBtn} onClick={startAudit} disabled={scanning}>
                <RefreshCw size={12} className={scanning ? "animate-spin" : ""} /> {t("app.refresh")}
              </button>
            </div>
          </div>

          <div className={styles.filters}>
            {(["all", "critical", "warning", "pass", "unknown"] as const).map(f => (
              <button
                key={f}
                className={`${styles.filterBtn} ${filterStatus === f ? styles.filterBtnActive : ""}`}
                onClick={() => setFilterStatus(f)}
              >
                {f === "all"      ? `${t("security.filterAll")} (${result.checks.length})` :
                 f === "critical" ? `${t("security.filterCritical")} (${result.critical_count})` :
                 f === "warning"  ? `${t("security.filterWarning")} (${result.warning_count})` :
                 f === "pass"     ? `${t("security.filterPass")} (${result.pass_count})` :
                                   `${t("security.filterUnknown")} (${result.unknown_count})`}
              </button>
            ))}
          </div>

          <div className={styles.checks}>
            {Object.entries(byCategory).map(([cat, catChecks]) => (
              <div key={cat} className={styles.category}>
                <div className={styles.categoryTitle}>{cat}</div>
                <div className={styles.checksList}>
                  {catChecks.map(check => (
                    <CheckCard key={check.id} check={check} />
                  ))}
                </div>
              </div>
            ))}
            {filteredChecks.length === 0 && (
              <div className={styles.noChecks}>{t("security.filterAll")}: 0</div>
            )}
          </div>
        </>
      )}

      {!result && !scanning && !error && (
        <div className={styles.emptyState}>
          <Shield size={48} style={{ opacity: 0.2 }} />
          <h2>{t("security.title")}</h2>
          <p>{t("security.run")}</p>
        </div>
      )}
    </div>
  );
}
