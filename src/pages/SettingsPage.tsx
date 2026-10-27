import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Info, Palette, Bot, ExternalLink, Bell, BellOff, Copy, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useServersStore } from "../stores/serversStore";
import { useNotificationSettings } from "../hooks/useNotificationSettings";
import { sendTestNotification } from "../services/notificationsService";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"general" | "appearance" | "ai" | "notifications" | "about">("general");

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("settings.title")}</h1>

      <div className={styles.layout}>
        <div className={styles.tabs}>
          {[
            { key: "general",       label: t("settings.general"),       icon: <Settings size={14} /> },
            { key: "ai",            label: t("settings.aiProviders"),   icon: <Bot size={14} /> },
            { key: "notifications", label: t("settings.notifications"), icon: <Bell size={14} /> },
            { key: "appearance",    label: t("settings.appearance"),    icon: <Palette size={14} /> },
            { key: "about",         label: t("settings.about"),         icon: <Info size={14} /> },
          ].map(({ key, label, icon }) => (
            <button
              key={key}
              className={`${styles.tab} ${activeTab === key ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(key as typeof activeTab)}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {activeTab === "general"       && <GeneralSettings />}
          {activeTab === "ai"            && <AiSettings />}
          {activeTab === "notifications" && <NotificationsSettings />}
          {activeTab === "appearance"    && <AppearanceSettings />}
          {activeTab === "about"         && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const METRICS_INTERVAL_KEY = "metrics_interval_sec";
  const [metricsInterval, setMetricsInterval] = useState(() =>
    localStorage.getItem(METRICS_INTERVAL_KEY) || "10"
  );
  const [autoConnect, setAutoConnect] = useState(
    () => localStorage.getItem("auto_connect") !== "false"
  );

  const handleIntervalChange = (value: string) => {
    setMetricsInterval(value);
    localStorage.setItem(METRICS_INTERVAL_KEY, value);
  };

  return (
    <div className={styles.section}>
      <h2>{t("settings.generalTitle")}</h2>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>{t("settings.languageLabel")}</div>
          <div className={styles.settingDesc}>{t("settings.languageDesc")}</div>
        </div>
        <select
          className={styles.select}
          value={i18n.language}
          onChange={(e) => {
            const lang = e.target.value;
            i18n.changeLanguage(lang);
            localStorage.setItem("i18n_language", lang);
          }}
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>{t("settings.autoConnect")}</div>
          <div className={styles.settingDesc}>{t("settings.autoConnectDesc")}</div>
        </div>
        <input
          type="checkbox"
          checked={autoConnect}
          onChange={(e) => {
            setAutoConnect(e.target.checked);
            localStorage.setItem("auto_connect", String(e.target.checked));
          }}
        />
      </div>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>{t("settings.metricsInterval")}</div>
          <div className={styles.settingDesc}>{t("settings.metricsIntervalDesc")}</div>
        </div>
        <select
          className={styles.select}
          value={metricsInterval}
          onChange={(e) => handleIntervalChange(e.target.value)}
        >
          <option value="5">{t("settings.sec5")}</option>
          <option value="10">{t("settings.sec10")}</option>
          <option value="30">{t("settings.sec30")}</option>
        </select>
      </div>
      <ExportImportSection />
      <CommandHistorySection />
    </div>
  );
}

function AiSettings() {
  const { t } = useTranslation();
  // TODO: Перенести ai_api_key в @tauri-apps/plugin-store с шифрованием.
  // Сейчас sessionStorage — очищается при закрытии приложения (лучше localStorage).
  // Таблица ai_providers в SQLite подготовлена для будущей миграции.
  const [apiUrl, setApiUrl] = useState(() => sessionStorage.getItem("ai_api_url") || localStorage.getItem("ai_api_url") || "");
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("ai_api_key") || localStorage.getItem("ai_api_key") || "");
  const [model, setModel]   = useState(() => sessionStorage.getItem("ai_model") || localStorage.getItem("ai_model") || "gpt-4o-mini");
  const [saved, setSaved]   = useState(false);
  const [saveError, setSaveError] = useState("");

  const save = () => {
    // Валидация URL: разрешён только http:// или https://
    if (apiUrl.trim()) {
      try {
        const parsed = new URL(apiUrl.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) {
          setSaveError(t("settings.invalidUrlError"));
          return;
        }
      } catch {
        setSaveError(t("settings.invalidUrlError"));
        return;
      }
    }
    setSaveError("");
    sessionStorage.setItem("ai_api_url", apiUrl);
    localStorage.removeItem("ai_api_url");
    sessionStorage.setItem("ai_api_key", apiKey);
    localStorage.removeItem("ai_api_key");
    sessionStorage.setItem("ai_model", model);
    localStorage.removeItem("ai_model");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={styles.section}>
      <h2>{t("settings.aiTitle")}</h2>
      <p className={styles.sectionDesc}>{t("settings.aiDesc")}</p>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label>{t("settings.apiUrl")}</label>
          <input className={styles.inp} value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.openai.com/v1" />
          <span className={styles.hint}>Ollama: http://localhost:11434/v1</span>
          {saveError && <div style={{ color: "var(--accent-red)", fontSize: 12, marginTop: 4 }}>{saveError}</div>}
        </div>
        <div className={styles.field}>
          <label>{t("settings.apiKeyOptional")}</label>
          <input type="password" className={styles.inp} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </div>
        <div className={styles.field}>
          <label>{t("settings.model")}</label>
          <input className={styles.inp} value={model}
            onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
          <span className={styles.hint}>gpt-4o, llama3, mistral, deepseek-coder</span>
        </div>
      </div>
      <button className={styles.saveBtn} onClick={save}>
        {saved ? t("settings.aiSaved") : t("settings.aiSave")}
      </button>
    </div>
  );
}

// ─── Notifications ────────────────────────────────────

function NotificationsSettings() {
  const { t } = useTranslation();
  const { settings, update } = useNotificationSettings();
  const [testSent, setTestSent] = useState(false);

  const handleTest = async () => {
    await sendTestNotification();
    setTestSent(true);
    setTimeout(() => setTestSent(false), 2500);
  };

  function Toggle({
    checked,
    onChange,
    disabled,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) {
    return (
      <button
        className={`${styles.toggle} ${checked ? styles.toggleOn : ""} ${disabled ? styles.toggleDisabled : ""}`}
        onClick={() => !disabled && onChange(!checked)}
        aria-pressed={checked}
        type="button"
      >
        <span className={styles.toggleThumb} />
      </button>
    );
  }

  function NumInput({
    value,
    onChange,
    min,
    max,
    suffix,
    disabled,
  }: {
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    suffix?: string;
    disabled?: boolean;
  }) {
    return (
      <div className={styles.numInputWrap}>
        <input
          type="number"
          className={styles.numInput}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const v = Math.max(min, Math.min(max, Number(e.target.value)));
            if (!isNaN(v)) onChange(v);
          }}
        />
        {suffix && <span className={styles.numSuffix}>{suffix}</span>}
      </div>
    );
  }

  const off = !settings.enabled;

  return (
    <div className={styles.section}>
      <h2>{t("settings.notificationsTitle")}</h2>
      <p className={styles.sectionDesc}>{t("settings.notificationsDesc")}</p>

      <div className={`${styles.settingRow} ${styles.settingRowMajor}`}>
        <div>
          <div className={styles.settingLabel}>
            {settings.enabled
              ? <><Bell size={13} style={{ display: "inline", marginRight: 6 }} />{t("settings.notifEnabled")}</>
              : <><BellOff size={13} style={{ display: "inline", marginRight: 6 }} />{t("settings.notifDisabled")}</>
            }
          </div>
          <div className={styles.settingDesc}>{t("settings.notifToggleDesc")}</div>
        </div>
        <Toggle checked={settings.enabled} onChange={(v) => update("enabled", v)} />
      </div>

      <div className={styles.notifGroup}>
        <div className={styles.notifGroupTitle}>{t("settings.notifEvents")}</div>

        {([
          { key: "serverOffline" as const, label: t("settings.notifServerOffline"), desc: t("settings.notifServerOfflineDesc") },
          { key: "cpuHigh"       as const, label: t("settings.notifCpuHigh"),       desc: t("settings.notifCpuHighDesc") },
          { key: "ramHigh"       as const, label: t("settings.notifRamHigh"),       desc: t("settings.notifRamHighDesc") },
          { key: "diskHigh"      as const, label: t("settings.notifDiskHigh"),      desc: t("settings.notifDiskHighDesc") },
          { key: "sslExpiring"   as const, label: t("settings.notifSslExpiring"),   desc: t("settings.notifSslExpiringDesc", { days: settings.sslDaysThreshold }) },
          { key: "sslExpired"    as const, label: t("settings.notifSslExpired"),    desc: t("settings.notifSslExpiredDesc") },
          { key: "backupFailed"  as const, label: t("settings.notifBackupFailed"),  desc: t("settings.notifBackupFailedDesc") },
          { key: "deployFailed"  as const, label: t("settings.notifDeployFailed"),  desc: t("settings.notifDeployFailedDesc") },
          { key: "deploySuccess" as const, label: t("settings.notifDeploySuccess"), desc: t("settings.notifDeploySuccessDesc") },
        ]).map(({ key, label, desc }) => (
          <div key={key} className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{label}</div>
              <div className={styles.settingDesc}>{desc}</div>
            </div>
            <Toggle
              checked={settings[key] as boolean}
              onChange={(v) => update(key, v)}
              disabled={off}
            />
          </div>
        ))}
      </div>

      <div className={styles.notifGroup}>
        <div className={styles.notifGroupTitle}>{t("settings.notifThresholds")}</div>

        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{t("settings.notifCpuThreshold")}</div>
            <div className={styles.settingDesc}>{t("settings.notifCpuThresholdDesc")}</div>
          </div>
          <NumInput value={settings.cpuThreshold} onChange={(v) => update("cpuThreshold", v)}
            min={1} max={99} suffix="%" disabled={off || !settings.cpuHigh} />
        </div>

        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{t("settings.notifRamThreshold")}</div>
            <div className={styles.settingDesc}>{t("settings.notifRamThresholdDesc")}</div>
          </div>
          <NumInput value={settings.ramThreshold} onChange={(v) => update("ramThreshold", v)}
            min={1} max={99} suffix="%" disabled={off || !settings.ramHigh} />
        </div>

        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{t("settings.notifDiskThreshold")}</div>
            <div className={styles.settingDesc}>{t("settings.notifDiskThresholdDesc")}</div>
          </div>
          <NumInput value={settings.diskThreshold} onChange={(v) => update("diskThreshold", v)}
            min={1} max={99} suffix="%" disabled={off || !settings.diskHigh} />
        </div>

        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{t("settings.notifSslDays")}</div>
            <div className={styles.settingDesc}>{t("settings.notifSslDaysDesc")}</div>
          </div>
          <NumInput value={settings.sslDaysThreshold} onChange={(v) => update("sslDaysThreshold", v)}
            min={1} max={365} suffix={t("settings.notifDaysSuffix")} disabled={off || !settings.sslExpiring} />
        </div>
      </div>

      <div className={styles.notifGroup}>
        <div className={styles.notifGroupTitle}>{t("settings.notifTesting")}</div>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{t("settings.notifTestLabel")}</div>
            <div className={styles.settingDesc}>{t("settings.notifTestDesc")}</div>
          </div>
          <button
            className={styles.testBtn}
            onClick={handleTest}
            disabled={!settings.enabled}
            title={!settings.enabled ? t("settings.notifDisabledTitle") : undefined}
          >
            {testSent ? t("settings.notifTestSent") : t("settings.notifTestBtn")}
          </button>
        </div>
        <p className={styles.notifHint}>{t("settings.notifAntiSpam")}</p>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState(() => localStorage.getItem("app_theme") || "dark");
  const handleThemeChange = (value: string) => {
    setTheme(value);
    localStorage.setItem("app_theme", value);
    document.documentElement.setAttribute("data-theme", value);
  };
  return (
    <div className={styles.section}>
      <h2>{t("settings.appearanceTitle")}</h2>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>{t("settings.themeLabel")}</div>
          <div className={styles.settingDesc}>{t("settings.themeDesc")}</div>
        </div>
        <select className={styles.select} value={theme} onChange={(e) => handleThemeChange(e.target.value)}>
          <option value="dark">{t("settings.darkTheme")}</option>
          <option value="light">{t("settings.lightTheme")}</option>
        </select>
      </div>
    </div>
  );
}

// ─── Экспорт / Импорт серверов ───────────────────────

function ExportImportSection() {
  const { t } = useTranslation();
  const { servers } = useServersStore();
  const [importError, setImportError] = useState("");

  const handleExport = () => {
    // Только публичные поля — без паролей и passphrase
    const exportData = servers.map((s) => ({
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      auth_type: s.auth_type,
      key_path: s.key_path,
      group_name: s.group_name,
      tags: s.tags,
      description: s.description,
      color: s.color,
      favorite: s.favorite,
    }));
    const json = JSON.stringify({ version: 1, servers: exportData }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `serverpilot-servers-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.servers)) {
          setImportError(t("settings.importInvalidFormat"));
          return;
        }
        const { addServer } = useServersStore.getState();
        for (const s of parsed.servers) {
          if (!s.name || !s.host || !s.username) continue;
          addServer({
            name: s.name,
            host: s.host,
            port: s.port ?? 22,
            username: s.username,
            auth_type: s.auth_type ?? "password",
            key_path: s.key_path,
            group_name: s.group_name,
            tags: s.tags ?? [],
            description: s.description ?? "",
            color: s.color ?? "#4f8ef7",
            favorite: s.favorite ?? false,
          }).catch(() => {});
        }
      } catch {
        setImportError(t("settings.importError"));
      } finally {
        e.target.value = "";
      }
    };
    reader.onerror = () => {
      setImportError(t("settings.importError"));
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  return (
    <div className={styles.notifGroup}>
      <div className={styles.notifGroupTitle}>{t("settings.exportImport")}</div>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>{t("settings.exportLabel")}</div>
          <div className={styles.settingDesc}>{t("settings.exportDesc")}</div>
        </div>
        <button className={styles.testBtn} onClick={handleExport}>{t("settings.exportBtn")}</button>
      </div>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>{t("settings.importLabel")}</div>
          <div className={styles.settingDesc}>{t("settings.importDesc")}</div>
        </div>
        <label className={styles.testBtn}>
          {t("settings.importBtn")}
          <input type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
        </label>
      </div>
      {importError && (
        <div style={{ color: "var(--accent-red)", fontSize: 12, padding: "4px 14px 10px" }}>
          {importError}
        </div>
      )}
    </div>
  );
}

// ─── История команд ─────────────────────────────────

function CommandHistorySection() {
  const { t } = useTranslation();
  const { servers } = useServersStore();
  const [history, setHistory] = useState<
    Array<{ id: number; server_id: string; command: string; executed_at: string; exit_code: number }>
  >([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<
        Array<{ id: number; server_id: string; command: string; executed_at: string; exit_code: number }>
      >("get_command_history", { limit: 50 });
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className={styles.notifGroup}>
      <div className={styles.notifGroupTitle} style={{ display: "flex", alignItems: "center" }}>
        {t("settings.commandHistory")}
        <button className={styles.testBtn} onClick={loadHistory} disabled={loading} title={t("app.refresh")} style={{ marginLeft: "auto" }}>
          ↺
        </button>
      </div>
      {history.length === 0 ? (
        <div style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>
          {t("settings.commandHistoryEmpty")}
        </div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {history.map((row) => {
            const serverName = servers.find((s) => s.id === row.server_id)?.name ?? row.server_id;
            const cmd = row.command.length > 80 ? row.command.slice(0, 80) + "…" : row.command;
            return (
              <div key={row.id} className={styles.settingRow} style={{ alignItems: "flex-start", padding: "8px 14px" }}>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", flex: 1, wordBreak: "break-all" }}>
                  {cmd}
                </code>
                <span style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 8px", whiteSpace: "nowrap" }}>
                  {serverName}
                </span>
                <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                  {row.exit_code === 0 ? (
                    <span style={{ color: "var(--accent-green)" }}>✓</span>
                  ) : (
                    <span style={{ color: "var(--accent-red)" }}>✗{row.exit_code}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Строка с копированием для донатов ───────────────

function DonateRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <code style={{
        fontSize: 11,
        background: "var(--bg-hover)",
        padding: "2px 6px",
        borderRadius: 4,
        color: "var(--text-secondary)",
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {value}
      </code>
      <button
        onClick={handleCopy}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          fontSize: 11,
          background: copied ? "var(--accent-green)" : "var(--bg-hover)",
          color: copied ? "#fff" : "var(--text-secondary)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 4,
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.2s",
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "✓" : label}
      </button>
    </div>
  );
}

function AboutSection() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const [version, setVersion] = useState("1.0.0");

  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch(() => {});
  }, []);

  const openUrl = async (url: string) => {
    try {
      await invoke("open_external_url", { url });
    } catch (err) {
      console.error("Failed to open URL:", err);
    }
  };

  return (
    <div className={styles.section}>
      {/* Logo and name */}
      <div className={styles.aboutHeader}>
        <div className={styles.aboutLogo}>SP</div>
        <div>
          <h2 className={styles.aboutName}>ServerPilot RU</h2>
          <span className={styles.aboutVersion}>{t("app.version")} {version} · Alpha</span>
        </div>
      </div>

      <p className={styles.aboutDesc}>
        {isEn
          ? "A local desktop tool for managing Linux/VPS servers over SSH — with an AI assistant, terminal, file manager, monitoring, and administration tools."
          : "Локальный desktop-инструмент для управления Linux/VPS-серверами через SSH с AI-ассистентом, терминалом, файловым менеджером, мониторингом и инструментами администрирования."}
      </p>

      <div className={styles.aboutBadges}>
        {["Local-first", "SSH-first", "Security-first", "No mandatory cloud"].map((b) => (
          <span key={b} className={styles.badge}>{b}</span>
        ))}
      </div>

      {/* Donate */}
      <div className={styles.supportSection} style={{ marginTop: 16 }}>
        <p className={styles.supportTitle}>
          {isEn ? "Support the project:" : "Поддержать проект:"}
        </p>
        <div className={styles.supportCards}>
          {/* CloudTips */}
          <div className={styles.supportCard}>
            <div className={styles.supportCardHeader}>
              <div className={styles.supportCardLogo} style={{ background: "linear-gradient(135deg, #0ea5e9, #0284c7)" }}>
                💳
              </div>
              <div>
                <button className={styles.supportLink} onClick={() => openUrl("https://pay.cloudtips.ru/p/62be13c3")}>
                  CloudTips <ExternalLink size={11} />
                </button>
                <div className={styles.supportUrl}>pay.cloudtips.ru</div>
              </div>
            </div>
            <p className={styles.supportCardDesc}>
              {isEn ? "Card, SBP — fast and easy." : "Карта, СБП — быстро и удобно."}
            </p>
            <DonateRow
              label={isEn ? "Copy link" : "Копировать ссылку"}
              value="https://pay.cloudtips.ru/p/62be13c3"
            />
          </div>

          {/* Capitalist */}
          <div className={styles.supportCard}>
            <div className={styles.supportCardHeader}>
              <div className={styles.supportCardLogo} style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
                🌐
              </div>
              <div>
                <button className={styles.supportLink} onClick={() => openUrl("https://capitalist.net")}>
                  Capitalist <ExternalLink size={11} />
                </button>
                <div className={styles.supportUrl}>capitalist.net</div>
              </div>
            </div>
            <p className={styles.supportCardDesc}>
              {isEn ? "International e-wallet. Send to account U22338724." : "Международный кошелёк. Перевод на счёт U22338724."}
            </p>
            <DonateRow
              label={isEn ? "Copy wallet" : "Копировать кошелёк"}
              value="U22338724"
            />
          </div>
        </div>
      </div>

      {/* Credits */}
      <div className={styles.supportSection}>
        <p className={styles.supportTitle}>
          {isEn
            ? "Created with the moral and financial support of:"
            : "ServerPilot RU создан при моральной и финансовой поддержке:"}
        </p>

        <div className={styles.supportCards}>
          {/* SerpMax */}
          <div className={styles.supportCard}>
            <div className={styles.supportCardHeader}>
              <div className={styles.supportCardLogo} style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
                S
              </div>
              <div>
                <button className={styles.supportLink} onClick={() => openUrl("https://serpmax.ru")}>
                  SerpMax <ExternalLink size={11} />
                </button>
                <div className={styles.supportUrl}>serpmax.ru</div>
              </div>
            </div>
            <p className={styles.supportCardDesc}>
              {isEn
                ? "SEO and website auditing platform — technical analysis, monitoring, and search optimization."
                : "SEO-платформа для анализа и аудита сайтов, мониторинга технического состояния и поисковой оптимизации."}
            </p>
          </div>

          {/* Vibes */}
          <div className={styles.supportCard}>
            <div className={styles.supportCardHeader}>
              <div className={styles.supportCardLogo} style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}>
                V
              </div>
              <div>
                <button className={styles.supportLink} onClick={() => openUrl("https://vibes.su")}>
                  Vibes <ExternalLink size={11} />
                </button>
                <div className={styles.supportUrl}>vibes.su</div>
              </div>
            </div>
            <p className={styles.supportCardDesc}>
              {isEn
                ? "Links, bio pages, QR codes and marketing tools for managing your digital presence."
                : "Сервис для работы со ссылками, bio-страницами, QR-кодами и инструментами для продвижения и управления цифровым присутствием."}
            </p>
          </div>

          {/* Vibes bio page */}
          <div className={styles.supportCard}>
            <div className={styles.supportCardHeader}>
              <div className={styles.supportCardLogo} style={{ background: "linear-gradient(135deg, #059669, #047857)" }}>
                Z
              </div>
              <div>
                <button className={styles.supportLink} onClick={() => openUrl("https://vibes.su/zmega")}>
                  zmega @ Vibes <ExternalLink size={11} />
                </button>
                <div className={styles.supportUrl}>vibes.su/zmega</div>
              </div>
            </div>
            <p className={styles.supportCardDesc}>
              {isEn
                ? "Author's page — links, projects and contacts."
                : "Страница автора — ссылки, проекты и контакты."}
            </p>
          </div>
        </div>
      </div>

      <div className={styles.aboutFooter}>
        <span>© {new Date().getFullYear()} ServerPilot RU</span>
        <span className={styles.aboutSep}>·</span>
        <span>{isEn ? "All data stored locally" : "Все данные хранятся локально"}</span>
      </div>
    </div>
  );
}
