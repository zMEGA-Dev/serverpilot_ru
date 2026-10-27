import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Code2, Plus, Play, Edit2, Trash2, Search, X,
  CheckCircle, XCircle, AlertTriangle, Clock,
  ChevronDown, RefreshCw, History, Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../services/sshQueue";
import { useServersStore } from "../stores/serversStore";
import type { CommandRisk } from "../types";
import { classifyRisk } from "../utils/classifyRisk";
import styles from "./ScriptsPage.module.css";

// ─── Типы ─────────────────────────────────────────────

interface Script {
  id: string;
  name: string;
  description: string;
  command: string;
  risk: CommandRisk;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
}

interface ScriptRun {
  id: string;
  script_id: string;
  script_name: string;
  server_id?: string;
  server_name: string;
  command: string;
  exit_code?: number;
  status: string;
  duration_ms: number;
  executed_at: string;
}

interface RunResult {
  run_id: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  status: string;
}

// ─── Утилиты ──────────────────────────────────────────

// classifyRisk импортирован из ../utils/classifyRisk

const RISK_LABEL: Record<string, string> = {
  read_only: "Read only",
  low:       "Low",
  medium:    "Medium",
  high:      "High",
  critical:  "Critical",
};
const RISK_COLOR: Record<string, string> = {
  read_only: "var(--accent-green)",
  low:       "var(--accent-green)",
  medium:    "var(--accent-yellow)",
  high:      "var(--accent-orange)",
  critical:  "var(--accent-red)",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}мс`;
  return `${(ms / 1000).toFixed(2)}с`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

// Подставить переменные {{name}} в команду
function applyVariables(command: string, vars: Record<string, string>): string {
  let result = command;
  for (const [key, val] of Object.entries(vars)) {
    // Валидируем: не позволяем shell-injection через значения переменных
    const safe = val.replace(/[;&|`$<>()\\'"]/g, "");
    result = result.replaceAll(`{{${key}}}`, safe);
  }
  return result;
}

// Извлечь имена переменных из команды
function extractVars(command: string): string[] {
  const matches = command.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

// ─── Форма скрипта ────────────────────────────────────

interface ScriptFormProps {
  script?: Script;
  onSave: (data: { name: string; description: string; command: string; risk: string }) => void;
  onClose: () => void;
}

function ScriptForm({ script, onSave, onClose }: ScriptFormProps) {
  const [name, setName]         = useState(script?.name ?? "");
  const [description, setDesc]  = useState(script?.description ?? "");
  const [command, setCommand]   = useState(script?.command ?? "");
  const [error, setError]       = useState("");
  const detectedRisk = classifyRisk(command);

  const handleSave = () => {
    if (!name.trim())    { setError("Укажите название"); return; }
    if (!command.trim()) { setError("Укажите команду");  return; }
    onSave({ name: name.trim(), description: description.trim(), command: command.trim(), risk: detectedRisk });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.formDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.formTitle}>
          <Code2 size={15} />
          {script ? "Редактировать скрипт" : "Новый скрипт"}
        </div>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label>Название *</label>
            <input className={styles.inp} value={name}
              onChange={e => setName(e.target.value)} placeholder="Проверить диск" />
          </div>
          <div className={styles.field}>
            <label>Описание</label>
            <input className={styles.inp} value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="Краткое описание что делает скрипт" />
          </div>
          <div className={styles.field}>
            <label>Команда *</label>
            <textarea className={`${styles.inp} ${styles.cmdArea}`} value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="df -h&#10;# Используйте {{переменная}} для параметров"
              rows={4} spellCheck={false} />
          </div>
        </div>

        {/* Риск */}
        {command && (
          <div className={styles.riskRow}>
            <span className={styles.riskLabel}>Риск:</span>
            <span className={styles.riskBadge} style={{ color: RISK_COLOR[detectedRisk] }}>
              {RISK_LABEL[detectedRisk]}
            </span>
            {(detectedRisk === "high" || detectedRisk === "critical") && (
              <span className={styles.riskWarn}>
                <AlertTriangle size={12} /> Опасная команда — убедитесь что это необходимо
              </span>
            )}
          </div>
        )}

        {/* Переменные */}
        {extractVars(command).length > 0 && (
          <div className={styles.varsHint}>
            <Zap size={12} /> Переменные: {extractVars(command).map(v => `{{${v}}}`).join(", ")}
            — значения будут запрошены при запуске
          </div>
        )}

        {error && <div className={styles.formError}><AlertTriangle size={12} /> {error}</div>}

        <div className={styles.formActions}>
          <button className={styles.btnCancel} onClick={onClose}>Отмена</button>
          <button className={styles.btnSave} onClick={handleSave}>
            {script ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Диалог запуска ───────────────────────────────────

interface RunDialogProps {
  script: Script;
  onRun: (serverId: string, serverName: string, variables: Record<string, string>) => void;
  onClose: () => void;
}

function RunDialog({ script, onRun, onClose }: RunDialogProps) {
  const { servers, connectionStatus } = useServersStore();
  const [selectedServer, setSelectedServer] = useState("");
  const [varValues, setVarValues]           = useState<Record<string, string>>({});
  const [confirmed, setConfirmed]           = useState(false);

  const vars = extractVars(script.command);
  const finalCommand = applyVariables(script.command, varValues);
  const risk = classifyRisk(finalCommand);
  const isDangerous = risk === "high" || risk === "critical";

  const onlineServers = servers.filter(s => connectionStatus[s.id] === "online");

  const handleRun = () => {
    if (!selectedServer) return;
    if (isDangerous && !confirmed) { setConfirmed(true); return; }
    const srv = servers.find(s => s.id === selectedServer);
    // SECURITY: передаём только variables — команда читается из БД на Rust-стороне
    onRun(selectedServer, srv?.name ?? selectedServer, varValues);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.runDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.formTitle}>
          <Play size={14} /> Запустить скрипт
        </div>

        <div className={styles.runInfo}>
          <span className={styles.runName}>{script.name}</span>
          <code className={styles.runCmd}>{script.command}</code>
        </div>

        {/* Переменные */}
        {vars.length > 0 && (
          <div className={styles.varsSection}>
            <div className={styles.varsTitle}>Значения переменных:</div>
            {vars.map(v => (
              <div key={v} className={styles.field}>
                <label>{`{{${v}}}`}</label>
                <input className={styles.inp} value={varValues[v] ?? ""}
                  onChange={e => setVarValues(p => ({ ...p, [v]: e.target.value }))}
                  placeholder={`Значение для ${v}`} />
              </div>
            ))}
            {finalCommand !== script.command && (
              <div className={styles.resolvedCmd}>
                <span className={styles.fieldLabel}>Итоговая команда:</span>
                <code className={styles.runCmd}>{finalCommand}</code>
              </div>
            )}
          </div>
        )}

        {/* Сервер */}
        <div className={styles.field}>
          <label>Сервер</label>
          {onlineServers.length === 0 ? (
            <div className={styles.noServers}>Нет подключённых серверов</div>
          ) : (
            <select className={styles.serverSelect} value={selectedServer}
              onChange={e => setSelectedServer(e.target.value)}>
              <option value="">— Выберите сервер —</option>
              {onlineServers.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
              ))}
            </select>
          )}
        </div>

        {/* Предупреждение для опасных команд */}
        {isDangerous && confirmed && (
          <div className={styles.dangerWarn}>
            <AlertTriangle size={14} />
            <div>
              <strong>Опасная команда ({RISK_LABEL[risk]})</strong>
              <p>Скрипт может изменить или удалить данные на сервере.</p>
            </div>
          </div>
        )}

        <div className={styles.formActions}>
          <button className={styles.btnCancel} onClick={onClose}>Отмена</button>
          <button
            className={isDangerous && !confirmed ? styles.btnWarn : styles.btnRun}
            onClick={handleRun}
            disabled={!selectedServer}
          >
            {isDangerous && !confirmed ? (
              <><AlertTriangle size={13} /> Продолжить</>
            ) : (
              <><Play size={13} /> Запустить</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Результат запуска ────────────────────────────────

interface RunResultPanelProps {
  result: RunResult;
  scriptName: string;
  serverName: string;
  onClose: () => void;
  onRunAgain: () => void;
}

function RunResultPanel({ result, scriptName, serverName, onClose, onRunAgain }: RunResultPanelProps) {
  const success = result.exit_code === 0;
  return (
    <div className={styles.resultPanel}>
      <div className={styles.resultHeader}>
        {success
          ? <CheckCircle size={16} style={{ color: "var(--accent-green)" }} />
          : <XCircle size={16} style={{ color: "var(--accent-red)" }} />}
        <div>
          <div className={styles.resultTitle}>{scriptName}</div>
          <div className={styles.resultMeta}>
            Сервер: {serverName} · Exit: {result.exit_code} · {formatDuration(result.duration_ms)}
          </div>
        </div>
        <div className={styles.resultActions}>
          <button className={styles.runAgainBtn} onClick={onRunAgain}>
            <RefreshCw size={12} /> Запустить снова
          </button>
          <button className={styles.closeResultBtn} onClick={onClose}><X size={14} /></button>
        </div>
      </div>

      {(result.stdout || result.stderr) && (
        <pre className={`${styles.resultOutput} ${!success ? styles.resultOutputErr : ""}`}>
          {result.stdout || result.stderr || "(нет вывода)"}
        </pre>
      )}
    </div>
  );
}

// ─── История запусков (панель) ────────────────────────

interface HistoryPanelProps {
  script: Script;
  onClose: () => void;
  onRunAgain: (scriptId: string) => void;
}

function HistoryPanel({ script, onClose, onRunAgain }: HistoryPanelProps) {
  const [runs, setRuns] = useState<ScriptRun[]>([]);

  useEffect(() => {
    invoke<ScriptRun[]>("scripts_run_history", { scriptId: script.id })
      .then(setRuns).catch(() => {});
  }, [script.id]);

  return (
    <div className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <span><History size={13} /> История: {script.name}</span>
        <button onClick={onClose}><X size={13} /></button>
      </div>
      <div className={styles.historyList}>
        {runs.length === 0 && (
          <div className={styles.historyEmpty}>Нет запусков</div>
        )}
        {runs.map(run => (
          <div key={run.id} className={`${styles.historyItem} ${run.status === "success" ? styles.histOk : styles.histErr}`}>
            <div className={styles.histTop}>
              {run.status === "success"
                ? <CheckCircle size={12} style={{ color: "var(--accent-green)" }} />
                : <XCircle size={12} style={{ color: "var(--accent-red)" }} />}
              <span className={styles.histServer}>{run.server_name}</span>
              <span className={styles.histDuration}>{formatDuration(run.duration_ms)}</span>
              <span className={styles.histTime}>{formatDate(run.executed_at)}</span>
            </div>
            {run.exit_code !== undefined && run.exit_code !== 0 && (
              <div className={styles.histExitCode}>exit {run.exit_code}</div>
            )}
          </div>
        ))}
      </div>
      <button className={styles.runAgainBtn2} onClick={() => onRunAgain(script.id)}>
        <Play size={12} /> Запустить снова
      </button>
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────

export function ScriptsPage() {
  const { t } = useTranslation();
  const [scripts, setScripts]           = useState<Script[]>([]);
  const [search, setSearch]             = useState("");
  const [showForm, setShowForm]         = useState(false);
  const [editScript, setEditScript]     = useState<Script | null>(null);
  const [runScript, setRunScript]       = useState<Script | null>(null);
  const [runResult, setRunResult]       = useState<{ result: RunResult; script: Script; serverName: string } | null>(null);
  const [histScript, setHistScript]     = useState<Script | null>(null);
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
  const [running, setRunning]           = useState(false);
  const [statusMsg, setStatusMsg]       = useState<{ text: string; ok: boolean } | null>(null);

  const loadScripts = () => {
    invoke<Script[]>("scripts_list").then(setScripts).catch(() => {});
  };

  useEffect(() => { loadScripts(); }, []);

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  // Сохранить (создать или обновить)
  const handleSave = async (data: { name: string; description: string; command: string; risk: string }) => {
    try {
      if (editScript) {
        await invoke("scripts_update", { id: editScript.id, request: data });
        showStatus("Скрипт обновлён");
      } else {
        await invoke("scripts_create", { request: data });
        showStatus("Скрипт создан");
      }
      setShowForm(false);
      setEditScript(null);
      loadScripts();
    } catch (err) { showStatus(String(err), false); }
  };

  // Удалить
  const handleDelete = async () => {
    if (!deleteScript) return;
    try {
      await invoke("scripts_delete", { id: deleteScript.id });
      setDeleteScript(null);
      showStatus("Скрипт удалён");
      loadScripts();
    } catch (err) { showStatus(String(err), false); }
  };

  // Запустить — передаём variables, команда читается из БД на Rust-стороне
  const handleRun = async (serverId: string, serverName: string, variables: Record<string, string>) => {
    if (!runScript) return;
    setRunScript(null);
    setRunning(true);
    try {
      const result = await sshInvoke<RunResult>("scripts_run", {
        scriptId: runScript.id,
        serverId,
        serverName,
        variables: Object.keys(variables).length > 0 ? variables : null,
      });
      setRunResult({ result, script: runScript, serverName });
      loadScripts(); // обновляем last_run_at
    } catch (err) {
      showStatus(String(err), false);
    } finally {
      setRunning(false);
    }
  };

  // Повторный запуск
  const handleRunAgain = (scriptId: string) => {
    setRunResult(null);
    setHistScript(null);
    const s = scripts.find(s => s.id === scriptId);
    if (s) setRunScript(s);
  };

  // Фильтрация
  const filtered = useMemo(() => {
    if (!search.trim()) return scripts;
    const q = search.toLowerCase();
    return scripts.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q)
    );
  }, [scripts, search]);

  return (
    <div className={styles.page}>
      {/* Шапка */}
      <div className={styles.header}>
        <h1><Code2 size={18} /> {t("scripts.title")}</h1>
        <div className={styles.headerRight}>
          <div className={styles.searchBox}>
            <Search size={13} className={styles.searchIcon} />
            <input className={styles.searchInput} value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("app.search")} />
            {search && <button className={styles.searchClear} onClick={() => setSearch("")}><X size={12} /></button>}
          </div>
          <button className={styles.newBtn} onClick={() => { setEditScript(null); setShowForm(true); }}>
            <Plus size={13} /> {t("scripts.add")}
          </button>
        </div>
      </div>

      {/* Статус */}
      {statusMsg && (
        <div className={`${styles.statusBar} ${statusMsg.ok ? styles.statusOk : styles.statusErr}`}>
          {statusMsg.text}
        </div>
      )}

      {/* Результат запуска */}
      {runResult && (
        <RunResultPanel
          result={runResult.result}
          scriptName={runResult.script.name}
          serverName={runResult.serverName}
          onClose={() => setRunResult(null)}
          onRunAgain={() => handleRunAgain(runResult.script.id)}
        />
      )}

      {/* Основной контент */}
      <div className={styles.mainArea}>
        {/* Список скриптов */}
        <div className={styles.scriptsList}>
          {filtered.length === 0 && (
            <div className={styles.emptyState}>
              <Code2 size={40} style={{ opacity: 0.2 }} />
              {search ? (
                <p>{t("app.search")}: 0</p>
              ) : (
                <>
                  <h2>{t("scripts.noScripts")}</h2>
                  <p>{t("scripts.noScriptsHint")}</p>
                </>
              )}
            </div>
          )}

          {filtered.map(script => (
            <div key={script.id} className={styles.scriptCard}>
              <div className={styles.scriptCardTop}>
                <div className={styles.scriptInfo}>
                  <span className={styles.scriptName}>{script.name}</span>
                  <span className={styles.riskBadge2} style={{ color: RISK_COLOR[script.risk] }}>
                    {RISK_LABEL[script.risk] ?? script.risk}
                  </span>
                </div>
                <div className={styles.scriptActions}>
                  <button className={styles.actionBtn}
                    onClick={() => setHistScript(s => s?.id === script.id ? null : script)}
                    title="История">
                    <History size={13} />
                  </button>
                  <button className={styles.actionBtn}
                    onClick={() => { setEditScript(script); setShowForm(true); }}
                    title="Редактировать">
                    <Edit2 size={13} />
                  </button>
                  <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={() => setDeleteScript(script)}
                    title="Удалить">
                    <Trash2 size={13} />
                  </button>
                  <button
                    className={styles.runBtn}
                    onClick={() => setRunScript(script)}
                    disabled={running}
                  >
                    {running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                    {t("scripts.run")}
                  </button>
                </div>
              </div>

              {script.description && (
                <p className={styles.scriptDesc}>{script.description}</p>
              )}

              <code className={styles.scriptCmd}>{script.command}</code>

              <div className={styles.scriptMeta}>
                <span>Создан: {formatDate(script.created_at)}</span>
                {script.last_run_at && (
                  <span><Clock size={11} /> Последний запуск: {formatDate(script.last_run_at)}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* История выбранного скрипта */}
        {histScript && (
          <HistoryPanel
            script={histScript}
            onClose={() => setHistScript(null)}
            onRunAgain={handleRunAgain}
          />
        )}
      </div>

      {/* Форма создания/редактирования */}
      {showForm && (
        <ScriptForm
          script={editScript ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditScript(null); }}
        />
      )}

      {/* Диалог запуска */}
      {runScript && (
        <RunDialog
          script={runScript}
          onRun={handleRun}
          onClose={() => setRunScript(null)}
        />
      )}

      {/* Диалог удаления */}
      {deleteScript && (
        <div className={styles.overlay} onClick={() => setDeleteScript(null)}>
          <div className={styles.deleteDialog} onClick={e => e.stopPropagation()}>
            <div className={styles.formTitle}>
              <AlertTriangle size={15} style={{ color: "var(--accent-red)" }} />
              Удалить скрипт?
            </div>
            <div className={styles.deleteInfo}>
              <strong>{deleteScript.name}</strong>
              <code className={styles.runCmd}>{deleteScript.command}</code>
            </div>
            <div className={styles.formActions}>
              <button className={styles.btnCancel} onClick={() => setDeleteScript(null)}>Отмена</button>
              <button className={styles.btnDelete} onClick={handleDelete}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
