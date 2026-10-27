import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch, GitPullRequest, FolderOpen, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Rocket, Clock,
  ChevronDown, ChevronUp, Terminal,
} from "lucide-react";
import { sshInvoke } from "../services/sshQueue";
import { useServersStore } from "../stores/serversStore";
import { useNavigate } from "react-router-dom";
import type {
  GitDetectResult, GitStatusResult, GitOperationResult, DeployRecord,
} from "../types";
import {
  loadNotificationSettings,
  notifyDeployFailed,
  notifyDeploySuccess,
} from "../services/notificationsService";
import styles from "./DeploymentPage.module.css";

// ─── localStorage helpers ─────────────────────────────

const HISTORY_KEY = "deploy_history";

function loadHistory(): DeployRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
}

function saveHistory(records: DeployRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, 50)));
}

// ─── Компонент вывода операции ────────────────────────

interface OutputPanelProps {
  output: string;
  running: boolean;
}
function OutputPanel({ output, running }: OutputPanelProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [output]);

  return (
    <div className={styles.outputWrap}>
      <div className={styles.outputHeader}>
        <Terminal size={13} />
        Git Output
        {running && <span className="spinner" style={{ width: 12, height: 12, marginLeft: 8 }} />}
      </div>
      <pre ref={ref} className={styles.output}>
        {output || t("app.noOutput")}
      </pre>
    </div>
  );
}

// ─── История деплоев ──────────────────────────────────

interface HistoryPanelProps {
  records: DeployRecord[];
  onClear: () => void;
}
function HistoryPanel({ records, onClear }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  if (records.length === 0) return null;
  return (
    <div className={styles.historySection}>
      <button className={styles.historyHeader} onClick={() => setExpanded(v => !v)}>
        <Clock size={14} />
        {t("deployment.history")}
        <span className={styles.historyCount}>{records.length}</span>
        <span style={{ marginLeft: "auto" }}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
      </button>
      {expanded && (
        <div className={styles.historyList}>
          {records.map((r) => (
            <div key={r.id} className={`${styles.historyItem} ${r.status === "success" ? styles.histSuccess : styles.histError}`}>
              <div className={styles.histTop}>
                {r.status === "success"
                  ? <CheckCircle size={13} style={{ color: "var(--accent-green)" }} />
                  : <XCircle size={13} style={{ color: "var(--accent-red)" }} />}
                <span className={styles.histRepo}>{r.repository.replace(/.*\//, "")}</span>
                <span className={styles.histBranch}>/{r.branch}</span>
                {r.commit && <code className={styles.histCommit}>{r.commit}</code>}
                <span className={styles.histTime}>{r.timestamp}</span>
              </div>
              <div className={styles.histMeta}>
                <span>{r.server_name}</span>
                <span>→ {r.directory}</span>
                <span>{r.message}</span>
              </div>
            </div>
          ))}
          <button className={styles.historyClear} onClick={onClear}>{t("app.delete")} {t("deployment.history")}</button>
        </div>
      )}
    </div>
  );
}

// ─── Диалог подтверждения pull при изменениях ─────────

interface ChangesDialogProps {
  changes: string;
  onConfirm: () => void;
  onCancel: () => void;
}
function ChangesDialog({ changes, onConfirm, onCancel }: ChangesDialogProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          <AlertTriangle size={16} style={{ color: "var(--accent-yellow)" }} />
          {t("deployment.uncommittedChanges").split(".")[0]}
        </div>
        <p className={styles.dialogMsg}>
          {t("deployment.uncommittedChanges")}
        </p>
        <pre className={styles.changesOutput}>{changes}</pre>
        <div className={styles.dialogActions}>
          <button className={styles.btnCancel} onClick={onCancel}>{t("app.cancel")}</button>
          <button className={styles.btnConfirm} onClick={onConfirm}>{t("app.confirm")}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────

export function DeploymentPage() {
  const { t } = useTranslation();
  const { selectedServerId, getSelectedServer, connectionStatus } = useServersStore();
  const server = getSelectedServer();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;
  const navigate = useNavigate();

  // Git info
  const [gitInfo, setGitInfo]   = useState<GitDetectResult | null>(null);
  const [repoStatus, setRepoStatus] = useState<GitStatusResult | null>(null);

  // Form
  const [gitUrl, setGitUrl]     = useState("");
  const [branch, setBranch]     = useState("main");
  const [directory, setDirectory] = useState("/var/www/");
  const [formError, setFormError] = useState("");

  // Operation
  const [running, setRunning]   = useState(false);
  const [output, setOutput]     = useState("");
  const [result, setResult]     = useState<GitOperationResult | null>(null);

  // History
  const [history, setHistory]   = useState<DeployRecord[]>(loadHistory);

  // Dialogs
  const [showChangesDialog, setShowChangesDialog] = useState(false);

  // ─ Обнаружение Git ─
  useEffect(() => {
    if (!selectedServerId || status !== "online") { setGitInfo(null); return; }
    sshInvoke<GitDetectResult>("git_detect", { serverId: selectedServerId })
      .then(setGitInfo)
      .catch(() => setGitInfo({ installed: false, version: "" }));
  }, [selectedServerId, status]);

  // ─ Статус репозитория ─
  const checkRepo = useCallback(async () => {
    if (!selectedServerId || !directory.trim()) return;
    try {
      const s = await sshInvoke<GitStatusResult>("git_repo_status", {
        serverId: selectedServerId,
        directory: directory.trim(),
      });
      setRepoStatus(s);
    } catch { setRepoStatus(null); }
  }, [selectedServerId, directory]);

  // ─ Добавить запись в историю ─
  const addHistory = (record: Omit<DeployRecord, "id" | "timestamp">) => {
    const rec: DeployRecord = {
      ...record,
      id: String(Date.now()),
      timestamp: new Date().toLocaleString("ru"),
    };
    setHistory(prev => {
      const updated = [rec, ...prev];
      saveHistory(updated);
      return updated;
    });
  };

  // ─ Клонировать ─
  const handleClone = async () => {
    setFormError("");
    if (!gitUrl.trim()) { setFormError("Укажите URL репозитория"); return; }
    if (!branch.trim()) { setFormError("Укажите ветку"); return; }
    if (!directory.trim()) { setFormError("Укажите директорию на сервере"); return; }
    if (!selectedServerId) { setFormError("Выберите сервер"); return; }

    setRunning(true);
    setOutput("");
    setResult(null);

    try {
      const r = await sshInvoke<GitOperationResult>("git_clone", {
        serverId: selectedServerId,
        url: gitUrl.trim(),
        branch: branch.trim(),
        directory: directory.trim(),
      });

      setOutput(r.output);
      setResult(r);

      addHistory({
        server_name: server?.name ?? selectedServerId,
        repository: gitUrl,
        branch,
        directory,
        commit: "",
        status: r.success ? "success" : "error",
        message: r.message,
      });

      // ── Desktop notifications: clone result ──────────────
      const ns = loadNotificationSettings();
      const serverName = server?.name ?? selectedServerId;
      if (!r.success) {
        notifyDeployFailed({
          serverId: selectedServerId,
          serverName,
          repository: gitUrl,
          message: r.message,
          settings: ns,
        });
      } else {
        notifyDeploySuccess({
          serverId: selectedServerId,
          serverName,
          repository: gitUrl,
          branch,
          settings: ns,
        });
      }
      // ────────────────────────────────────────────────────

      if (r.success) await checkRepo();
    } catch (err) {
      setResult({ success: false, output: String(err), exit_code: -1, message: String(err) });
    } finally {
      setRunning(false);
    }
  };

  // ─ Pull (с проверкой изменений) ─
  const handlePull = async (force = false) => {
    setShowChangesDialog(false);
    if (!selectedServerId) return;

    // Проверяем незакоммиченные изменения если не force
    if (!force && repoStatus?.has_changes) {
      setShowChangesDialog(true);
      return;
    }

    setRunning(true);
    setOutput("");
    setResult(null);

    try {
      const r = await sshInvoke<GitOperationResult>("git_pull", {
        serverId: selectedServerId,
        directory: directory.trim(),
        branch: branch.trim(),
      });

      setOutput(r.output);
      setResult(r);

      addHistory({
        server_name: server?.name ?? selectedServerId,
        repository: gitUrl || directory,
        branch,
        directory,
        commit: repoStatus?.commit_hash ?? "",
        status: r.success ? "success" : "error",
        message: r.message,
      });

      // ── Desktop notifications: pull result ───────────────
      const ns = loadNotificationSettings();
      const serverName = server?.name ?? selectedServerId;
      const repo = gitUrl || directory;
      if (!r.success) {
        notifyDeployFailed({
          serverId: selectedServerId,
          serverName,
          repository: repo,
          message: r.message,
          settings: ns,
        });
      } else {
        notifyDeploySuccess({
          serverId: selectedServerId,
          serverName,
          repository: repo,
          branch,
          settings: ns,
        });
      }
      // ────────────────────────────────────────────────────

      if (r.success) await checkRepo();
    } catch (err) {
      setResult({ success: false, output: String(err), exit_code: -1, message: String(err) });
    } finally {
      setRunning(false);
    }
  };

  // ─ Открыть директорию в файловом менеджере ─
  const openInFiles = () => {
    // Сохраняем путь в sessionStorage — FilesPage его подхватит
    sessionStorage.setItem("files_open_path", directory.trim());
    navigate("/files");
  };

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Rocket size={40} style={{ opacity: 0.3 }} />
        <p>{t("deployment.connectHint")}</p>
      </div>
    );
  }

  if (gitInfo && !gitInfo.installed) {
    return (
      <div className={styles.notInstalled}>
        <GitBranch size={48} style={{ opacity: 0.25 }} />
        <h2>Git not installed</h2>
        <p>Git must be installed on the server to use Git deploy.</p>
        <code className={styles.installCode}>apt install git  # Debian/Ubuntu</code>
        <code className={styles.installCode}>yum install git  # CentOS/RHEL</code>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>
          <Rocket size={18} /> {t("deployment.title")}
        </h1>
        {gitInfo?.installed && (
          <span className={styles.gitVersion}>Git {gitInfo.version}</span>
        )}
      </div>

      <div className={styles.mainArea}>
        <div className={styles.formCard}>
          <h2 className={styles.formTitle}>{t("deployment.repository")}</h2>

          <div className={styles.fields}>
            <div className={styles.field}>
              <label>Git URL</label>
              <input
                className={styles.inp}
                value={gitUrl}
                onChange={e => setGitUrl(e.target.value)}
                placeholder="https://github.com/user/project.git"
              />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label>{t("deployment.branch")}</label>
                <input
                  className={styles.inp}
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
              <div className={styles.field} style={{ flex: 2 }}>
                <label>{t("deployment.directory")}</label>
                <input
                  className={styles.inp}
                  value={directory}
                  onChange={e => setDirectory(e.target.value)}
                  placeholder="/var/www/project"
                  onBlur={checkRepo}
                />
              </div>
            </div>
          </div>

          {formError && (
            <div className={styles.formError}><AlertTriangle size={13} /> {formError}</div>
          )}

          {repoStatus && (
            <div className={`${styles.repoStatus} ${repoStatus.is_repo ? styles.repoStatusOk : styles.repoStatusNew}`}>
              {repoStatus.is_repo ? (
                <>
                  <div className={styles.repoStatusRow}>
                    <GitBranch size={13} />
                    <span>{t("deployment.branch")}: <strong>{repoStatus.branch}</strong></span>
                    {repoStatus.commit_hash && (
                      <code className={styles.commitHash}>{repoStatus.commit_hash}</code>
                    )}
                  </div>
                  {repoStatus.commit_message && (
                    <div className={styles.commitMsg}>{repoStatus.commit_message}</div>
                  )}
                  {repoStatus.has_changes && (
                    <div className={styles.changesWarn}>
                      <AlertTriangle size={12} /> {t("deployment.uncommittedChanges")}
                    </div>
                  )}
                </>
              ) : (
                <span>{t("deployment.noRepo")}</span>
              )}
            </div>
          )}

          <div className={styles.actions}>
            <button className={styles.btnClone} onClick={handleClone} disabled={running}>
              <GitBranch size={14} />
              {running ? t("deployment.cloning") : t("deployment.cloneBtn")}
            </button>

            <button
              className={styles.btnPull}
              onClick={() => handlePull(false)}
              disabled={running || !repoStatus?.is_repo}
            >
              <GitPullRequest size={14} />
              {running ? t("deployment.pulling") : t("deployment.pullBtn")}
            </button>

            <button className={styles.btnRefresh} onClick={checkRepo} disabled={running} title={t("app.refresh")}>
              <RefreshCw size={13} />
            </button>

            {result?.success && (
              <button className={styles.btnFiles} onClick={openInFiles}>
                <FolderOpen size={13} /> {t("deployment.openFiles")}
              </button>
            )}
          </div>
        </div>

        {(output || running) && (
          <div className={styles.resultCard}>
            {result && (
              <div className={`${styles.resultBanner} ${result.success ? styles.resultOk : styles.resultErr}`}>
                {result.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {result.message}
                {result.exit_code !== 0 && (
                  <span className={styles.exitCode}>exit {result.exit_code}</span>
                )}
              </div>
            )}
            <OutputPanel output={output} running={running} />
          </div>
        )}

        <HistoryPanel
          records={history}
          onClear={() => { setHistory([]); saveHistory([]); }}
        />
      </div>

      {showChangesDialog && repoStatus && (
        <ChangesDialog
          changes={repoStatus.changes_summary}
          onConfirm={() => handlePull(true)}
          onCancel={() => { setShowChangesDialog(false); }}
        />
      )}
    </div>
  );
}
