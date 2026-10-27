import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw, Globe, Plus, CheckCircle, XCircle,
  AlertTriangle, ToggleLeft, ToggleRight, Trash2,
  Edit2, Play, X, Server, FileCode, Lock,
} from "lucide-react";
import { sshInvoke } from "../services/sshQueue";
import { useServersStore } from "../stores/serversStore";
import type { NginxInfo, NginxSite, NginxResult } from "../types";
import { SslPanel } from "../features/nginx/SslPanel";
import styles from "./NginxPage.module.css";

import MonacoEditor from "@monaco-editor/react";

// ─── Диалог подтверждения ─────────────────────────────

interface ConfirmProps {
  title: string;
  message: string;
  dangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
function ConfirmDialog({ title, message, dangerous, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          {dangerous && <AlertTriangle size={16} style={{ color: "var(--accent-red)" }} />}
          {title}
        </div>
        <p className={styles.dialogMsg}>{message}</p>
        <div className={styles.dialogActions}>
          <button className={styles.btnCancel} onClick={onCancel}>Отмена</button>
          <button className={dangerous ? styles.btnDelete : styles.btnConfirm} onClick={onConfirm}>
            {dangerous ? "Удалить" : "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Форма создания сайта ─────────────────────────────

interface CreateSiteFormProps {
  serverId: string;
  onClose: () => void;
  onCreated: () => void;
}
function CreateSiteForm({ serverId, onClose, onCreated }: CreateSiteFormProps) {
  const [domain, setDomain] = useState("");
  const [port, setPort]     = useState(80);
  const [rootDir, setRootDir] = useState("/var/www/");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [result, setResult] = useState<NginxResult | null>(null);

  const handleCreate = async () => {
    if (!domain.trim()) { setError("Укажите домен"); return; }
    setLoading(true); setError("");
    try {
      const r = await sshInvoke<NginxResult>("nginx_create_site", {
        serverId, domain: domain.trim(), port, rootDir: rootDir.trim(),
      });
      setResult(r);
      if (r.success) { onCreated(); }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.createForm} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogTitle}><Plus size={15} /> Создать сайт</div>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label>Домен</label>
            <input className={styles.inp} value={domain}
              onChange={e => setDomain(e.target.value)} placeholder="example.com" />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field} style={{ flex: "0 0 120px" }}>
              <label>Порт</label>
              <input type="number" className={styles.inp} value={port}
                onChange={e => setPort(Number(e.target.value))} />
            </div>
            <div className={styles.field}>
              <label>Root директория</label>
              <input className={styles.inp} value={rootDir}
                onChange={e => setRootDir(e.target.value)} placeholder="/var/www/example.com" />
            </div>
          </div>
        </div>

        {error && <div className={styles.formError}><AlertTriangle size={12} /> {error}</div>}

        {result && (
          <div className={`${styles.resultBanner} ${result.success ? styles.resultOk : styles.resultErr}`}>
            {result.success ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {result.message}
          </div>
        )}

        {result?.success && result.output && (
          <pre className={styles.configPreview}>{result.output}</pre>
        )}

        <div className={styles.dialogActions}>
          <button className={styles.btnCancel} onClick={onClose}>
            {result?.success ? "Закрыть" : "Отмена"}
          </button>
          {!result?.success && (
            <button className={styles.btnConfirm} onClick={handleCreate} disabled={loading}>
              {loading ? "Создание..." : "Создать"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Редактор конфига ────────────────────────────────

interface ConfigEditorProps {
  serverId: string;
  site: NginxSite;
  onClose: () => void;
  onSaved: () => void;
}
function ConfigEditor({ serverId, site, onClose, onSaved }: ConfigEditorProps) {
  const [content, setContent]         = useState("");
  const [originalContent, setOriginal] = useState("");
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [result, setResult]           = useState<NginxResult | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  useEffect(() => {
    sshInvoke<string>("nginx_read_config", { serverId, configPath: site.config_path })
      .then(c => { setContent(c); setOriginal(c); })
      .catch(e => setContent(`# Ошибка чтения: ${e}`))
      .finally(() => setLoading(false));
  }, [serverId, site.config_path]);

  const handleSave = async () => {
    setSaving(true); setResult(null);
    try {
      const r = await sshInvoke<NginxResult>("nginx_write_config", {
        serverId, configPath: site.config_path, content,
      });
      setResult(r);
      if (r.success) { setOriginal(content); onSaved(); }
      else setShowRestore(true);
    } catch (err) { setResult({ success: false, output: "", message: String(err) }); }
    finally { setSaving(false); }
  };

  const handleRestore = async () => {
    setShowRestore(false);
    try {
      const r = await sshInvoke<NginxResult>("nginx_restore_backup", {
        serverId, configPath: site.config_path,
      });
      setResult(r);
      if (r.success) {
        // Перечитываем файл
        const c = await sshInvoke<string>("nginx_read_config", { serverId, configPath: site.config_path });
        setContent(c); setOriginal(c);
      }
    } catch (err) { setResult({ success: false, output: "", message: String(err) }); }
  };

  const isDirty = content !== originalContent;

  return (
    <div className={styles.editorOverlay}>
      <div className={styles.editorPanel}>
        {/* Шапка */}
        <div className={styles.editorHeader}>
          <div className={styles.editorTitle}>
            <FileCode size={14} />
            {site.name}
            {isDirty && <span className={styles.dirtyDot} title="Несохранённые изменения" />}
          </div>
          <span className={styles.editorPath}>{site.config_path}</span>
          <div className={styles.editorActions}>
            {showRestore && (
              <button className={styles.btnRestore} onClick={handleRestore}>
                Восстановить резервную копию
              </button>
            )}
            <button className={`${styles.btnSave} ${isDirty ? styles.btnSaveDirty : ""}`}
              onClick={handleSave} disabled={saving || !isDirty}>
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
            <button className={styles.editorClose} onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        {/* Результат */}
        {result && (
          <div className={`${styles.resultBanner} ${result.success ? styles.resultOk : styles.resultErr}`}>
            {result.success ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {result.message}
            {result.output && <span className={styles.resultOutput}>{result.output}</span>}
          </div>
        )}

        {/* Monaco Editor */}
        <div className={styles.monacoWrap}>
          {loading ? (
            <div className={styles.loading}><span className="spinner" /> Загрузка конфигурации...</div>
          ) : (
            <MonacoEditor
              height="100%"
              language="nginx"
              value={content}
              onChange={v => setContent(v ?? "")}
              options={{
                theme: "vs-dark",
                fontSize: 13,
                fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
                lineNumbers: "on",
                minimap: { enabled: false },
                wordWrap: "on",
                automaticLayout: true,
                padding: { top: 10 },
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────

export function NginxPage() {
  const { t } = useTranslation();
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [info, setInfo]               = useState<NginxInfo | null>(null);
  const [sites, setSites]             = useState<NginxSite[]>([]);
  const [loading, setLoading]         = useState(false);
  const [opResult, setOpResult]       = useState<NginxResult | null>(null);
  const [editSite, setEditSite]       = useState<NginxSite | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [sslSite, setSslSite]         = useState<NginxSite | null>(null);
  const [confirm, setConfirm]         = useState<{ title: string; msg: string; dangerous?: boolean; action: () => void } | null>(null);

  const showStatus = (r: NginxResult) => {
    setOpResult(r);
    setTimeout(() => setOpResult(null), 6000);
  };

  const loadData = useCallback(async () => {
    if (!selectedServerId || status !== "online") return;
    setLoading(true);
    try {
      const [infoData, sitesData] = await Promise.all([
        sshInvoke<NginxInfo>("nginx_detect", { serverId: selectedServerId }),
        sshInvoke<NginxSite[]>("nginx_list_sites", { serverId: selectedServerId }),
      ]);
      setInfo(infoData);
      setSites(sitesData);
    } catch (err) {
      setInfo({ installed: false, version: "", running: false, config_ok: false,
        config_test_output: String(err), has_sites_available: false,
        has_sites_enabled: false, has_conf_d: false });
    } finally { setLoading(false); }
  }, [selectedServerId, status]);

  useEffect(() => { if (status === "online") loadData(); }, [selectedServerId, status]);

  const handleTestConfig = async () => {
    if (!selectedServerId) return;
    const r = await sshInvoke<NginxResult>("nginx_test_config", { serverId: selectedServerId });
    showStatus(r);
  };

  const handleReload = async () => {
    if (!selectedServerId) return;
    const r = await sshInvoke<NginxResult>("nginx_reload", { serverId: selectedServerId });
    showStatus(r);
    if (r.success) loadData();
  };

  const handleEnable = async (site: NginxSite) => {
    if (!selectedServerId) return;
    const r = await sshInvoke<NginxResult>("nginx_enable_site", { serverId: selectedServerId, siteName: site.name });
    showStatus(r);
    if (r.success) loadData();
  };

  const handleDisable = async (site: NginxSite) => {
    setConfirm({
      title: `Отключить сайт ${site.name}?`,
      msg: `Сайт будет отключён. Конфигурация сохранится в sites-available.`,
      action: async () => {
        setConfirm(null);
        if (!selectedServerId) return;
        const r = await sshInvoke<NginxResult>("nginx_disable_site", { serverId: selectedServerId, siteName: site.name });
        showStatus(r);
        if (r.success) loadData();
      },
    });
  };

  const handleDelete = (site: NginxSite) => {
    setConfirm({
      title: `Удалить конфигурацию ${site.name}?`,
      msg: `Файл ${site.config_path} будет удалён.\n\nФайлы сайта (${site.root}) НЕ будут удалены.`,
      dangerous: true,
      action: async () => {
        setConfirm(null);
        if (!selectedServerId) return;
        const r = await sshInvoke<NginxResult>("nginx_delete_config", {
          serverId: selectedServerId, configPath: site.config_path, siteName: site.name,
        });
        showStatus(r);
        if (r.success) loadData();
      },
    });
  };

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <Server size={40} style={{ opacity: 0.3 }} />
        <p>{t("nginx.detectHint")}</p>
      </div>
    );
  }

  if (info && !info.installed) {
    return (
      <div className={styles.notInstalled}>
        <Globe size={48} style={{ opacity: 0.25 }} />
        <h2>{t("nginx.notInstalled")}</h2>
        <p>{t("nginx.notInstalledHint")}</p>
        <code className={styles.installCode}>apt install nginx   # Debian/Ubuntu</code>
        <code className={styles.installCode}>yum install nginx   # CentOS/RHEL</code>
        <button className={styles.refreshBtn} onClick={loadData}>
          <RefreshCw size={13} /> {t("app.refresh")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Шапка */}
      <div className={styles.header}>
        <h1><Globe size={18} /> {t("nginx.title")}</h1>
        <div className={styles.headerRight}>
          {info && (
            <div className={styles.infoRow}>
              <span className={`${styles.statusDot} ${info.running ? styles.dotOnline : styles.dotOffline}`} />
              <span className={styles.version}>{info.version}</span>
              <span className={`${styles.configStatus} ${info.config_ok ? styles.configOk : styles.configErr}`}>
                {info.config_ok ? t("nginx.testOk") : t("nginx.testFail")}
              </span>
            </div>
          )}
          <button className={styles.toolBtn} onClick={handleTestConfig} disabled={loading}>
            <CheckCircle size={13} /> {t("nginx.testConfig")}
          </button>
          <button className={styles.reloadBtn} onClick={handleReload} disabled={loading}>
            <RefreshCw size={13} /> {t("nginx.reload")}
          </button>
          <button className={styles.iconBtn} onClick={loadData} disabled={loading} title={t("app.refresh")}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Результат операции */}
      {opResult && (
        <div className={`${styles.opResult} ${opResult.success ? styles.opOk : styles.opErr}`}>
          {opResult.success ? <CheckCircle size={13} /> : <XCircle size={13} />}
          <span>{opResult.message}</span>
          {opResult.output && (
            <pre className={styles.opOutput}>{opResult.output}</pre>
          )}
          <button className={styles.opClose} onClick={() => setOpResult(null)}><X size={12} /></button>
        </div>
      )}

      {/* Список сайтов */}
      <div className={styles.sitesSection}>
        <div className={styles.sitesSectionHeader}>
          <h2>{t("nginx.sites")} <span className={styles.sitesCount}>{sites.length}</span></h2>
          <button className={styles.createBtn} onClick={() => setShowCreate(true)}>
            <Plus size={13} /> {t("nginx.newConfig")}
          </button>
        </div>

        {loading && sites.length === 0 && (
          <div className={styles.loadingRow}><span className="spinner" /> {t("nginx.loading")}</div>
        )}

        {!loading && sites.length === 0 && (
          <div className={styles.emptySites}>{t("nginx.notInstalledHint")}</div>
        )}

        <div className={styles.sitesList}>
          {sites.map(site => (
            <div key={site.name} className={styles.siteCard}>
              <div className={styles.siteCardTop}>
                <div className={styles.siteCardLeft}>
                  <span className={`${styles.enabledDot} ${site.enabled ? styles.dotOnline : styles.dotOffline}`} />
                  <span className={styles.siteName}>{site.name}</span>
                  {site.has_ssl && <span className={styles.sslBadge}>SSL</span>}
                  {site.enabled
                    ? <span className={styles.enabledBadge}>{t("nginx.enabled")}</span>
                    : <span className={styles.disabledBadge}>{t("nginx.disabled")}</span>}
                </div>
                <div className={styles.siteCardActions}>
                  <button className={styles.siteBtn} onClick={() => setEditSite(site)} title="Редактировать конфиг">
                    <Edit2 size={12} />
                  </button>
                  <button className={`${styles.siteBtn} ${styles.siteBtnSsl}`} onClick={() => setSslSite(s => s?.name === site.name ? null : site)} title="SSL">
                    <Lock size={12} /> SSL
                  </button>
                  {site.enabled
                    ? <button className={`${styles.siteBtn} ${styles.siteBtnWarn}`} onClick={() => handleDisable(site)} title={t("nginx.disable")}>
                        <ToggleLeft size={12} /> {t("nginx.disable")}
                      </button>
                    : <button className={`${styles.siteBtn} ${styles.siteBtnGreen}`} onClick={() => handleEnable(site)} title={t("nginx.enable")}>
                        <ToggleRight size={12} /> {t("nginx.enable")}
                      </button>
                  }
                  <button className={`${styles.siteBtn} ${styles.siteBtnDanger}`} onClick={() => handleDelete(site)} title="Удалить конфиг">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              <div className={styles.siteCardMeta}>
                {site.server_names.length > 0 && (
                  <span className={styles.metaItem}>
                    <Globe size={11} /> {site.server_names.join(", ")}
                  </span>
                )}
                {site.listen_ports.length > 0 && (
                  <span className={styles.metaItem}>
                    :{site.listen_ports.join(", :")}
                  </span>
                )}
                {site.root && (
                  <span className={`${styles.metaItem} ${styles.metaPath}`}>{site.root}</span>
                )}
              </div>

              <div className={styles.siteConfigPath}>{site.config_path}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SSL панель */}
      {sslSite && selectedServerId && (
        <SslPanel
          serverId={selectedServerId}
          site={sslSite}
          onClose={() => setSslSite(null)}
          onReloadNeeded={loadData}
        />
      )}

      {/* Редактор конфига */}
      {editSite && (
        <ConfigEditor
          serverId={selectedServerId!}
          site={editSite}
          onClose={() => setEditSite(null)}
          onSaved={() => { loadData(); }}
        />
      )}

      {/* Форма создания */}
      {showCreate && (
        <CreateSiteForm
          serverId={selectedServerId!}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadData(); }}
        />
      )}

      {/* Диалог подтверждения */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.msg}
          dangerous={confirm.dangerous}
          onConfirm={confirm.action}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
