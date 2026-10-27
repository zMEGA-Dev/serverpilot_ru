/**
 * SslPanel — панель SSL для выбранного Nginx-сайта.
 * Встраивается в NginxPage рядом с карточкой сайта.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Shield, ShieldCheck, ShieldOff, ShieldAlert,
  RefreshCw, X, AlertTriangle, CheckCircle,
  XCircle, Lock, Unlock, Info, Play,
} from "lucide-react";
import { sshInvoke } from "../../services/sshQueue";
import { useServersStore } from "../../stores/serversStore";
import type {
  NginxSite, SslStatus, CertbotInfo,
  RenewalStatus, SslResult,
} from "../../types";
import {
  loadNotificationSettings,
  notifySslExpiring,
  notifySslExpired,
} from "../../services/notificationsService";
import styles from "./SslPanel.module.css";

interface SslPanelProps {
  serverId: string;
  site: NginxSite;
  onClose: () => void;
  onReloadNeeded: () => void;
}

// ─── Форма получения сертификата ──────────────────────

interface ObtainFormProps {
  serverId: string;
  site: NginxSite;
  onSuccess: () => void;
  onCancel: () => void;
}
function ObtainForm({ serverId, site, onSuccess, onCancel }: ObtainFormProps) {
  const [domain, setDomain] = useState(site.server_names[0] ?? "");
  const [email, setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SslResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleObtain = async () => {
    if (!confirmed) { setConfirmed(true); return; }
    setLoading(true);
    try {
      const r = await sshInvoke<SslResult>("ssl_obtain_cert", {
        serverId,
        domain,
        email,
        nginxConfigPath: site.config_path,
      });
      setResult(r);
      if (r.success) setTimeout(onSuccess, 2000);
    } catch (err) {
      setResult({ success: false, output: "", message: String(err) });
    } finally { setLoading(false); }
  };

  return (
    <div className={styles.obtainForm}>
      <div className={styles.obtainTitle}>
        <Lock size={14} /> Получить SSL-сертификат
      </div>

      {!confirmed ? (
        <>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label>Домен</label>
              <input className={styles.inp} value={domain}
                onChange={e => setDomain(e.target.value)}
                placeholder="example.com" />
            </div>
            <div className={styles.field}>
              <label>Email (для уведомлений Let's Encrypt)</label>
              <input className={styles.inp} type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com" />
            </div>
          </div>

          <div className={styles.notice}>
            <Info size={13} />
            <div>
              <strong>Требования перед получением:</strong>
              <ul className={styles.noticeList}>
                <li>Домен <strong>{domain || "..."}</strong> должен указывать на этот сервер</li>
                <li>Порт 80 должен быть открыт (HTTP challenge)</li>
                <li>Nginx должен быть запущен</li>
              </ul>
            </div>
          </div>

          <div className={styles.obtainActions}>
            <button className={styles.btnCancel} onClick={onCancel}>Отмена</button>
            <button
              className={styles.btnObtain}
              onClick={handleObtain}
              disabled={!domain.trim() || !email.trim()}
            >
              Продолжить
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.confirmBlock}>
            <AlertTriangle size={16} style={{ color: "var(--accent-yellow)", flexShrink: 0 }} />
            <div>
              <strong>Подтверждение</strong>
              <p>Будет запущен Certbot для домена <strong>{domain}</strong>.</p>
              <p>Nginx-конфигурация будет изменена и резервная копия будет создана.</p>
            </div>
          </div>

          {result && (
            <div className={`${styles.resultBanner} ${result.success ? styles.resultOk : styles.resultErr}`}>
              {result.success ? <CheckCircle size={13} /> : <XCircle size={13} />}
              <div>
                <div>{result.message}</div>
                {result.output && (
                  <pre className={styles.resultOutput}>{result.output.slice(0, 1000)}</pre>
                )}
              </div>
            </div>
          )}

          <div className={styles.obtainActions}>
            <button className={styles.btnCancel} onClick={() => { setConfirmed(false); setResult(null); }}>
              Назад
            </button>
            <button
              className={styles.btnObtain}
              onClick={handleObtain}
              disabled={loading || result?.success}
            >
              {loading ? <><RefreshCw size={13} className="animate-spin" /> Получение...</>
                       : <><Lock size={13} /> Получить сертификат</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Главный компонент ────────────────────────────────

export function SslPanel({ serverId, site, onClose, onReloadNeeded }: SslPanelProps) {
  const { servers } = useServersStore();
  const [sslStatus, setSslStatus]     = useState<SslStatus | null>(null);
  const [certbotInfo, setCertbotInfo] = useState<CertbotInfo | null>(null);
  const [renewal, setRenewal]         = useState<RenewalStatus | null>(null);
  const [days, setDays]               = useState<number | null>(null);
  const [loading, setLoading]         = useState(true);
  const [showObtainForm, setShowObtainForm] = useState(false);
  const [dryRunResult, setDryRunResult]     = useState<SslResult | null>(null);
  const [dryRunLoading, setDryRunLoading]   = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ssl, certbot, ren] = await Promise.all([
        sshInvoke<SslStatus>("ssl_check_site", {
          serverId,
          configPath: site.config_path,
          domain: site.server_names[0] ?? "",
        }),
        sshInvoke<CertbotInfo>("ssl_detect_certbot", { serverId }),
        sshInvoke<RenewalStatus>("ssl_renewal_status", { serverId }),
      ]);
      setSslStatus(ssl);
      setCertbotInfo(certbot);
      setRenewal(ren);

      // Получаем реальное кол-во дней если есть cert_path
      let realDaysValue: number | null = null;
      if (ssl.cert_path) {
        const d = await sshInvoke<number>("ssl_cert_days", {
          serverId, certPath: ssl.cert_path,
        });
        setDays(d);
        realDaysValue = d;
      }

      // ── Desktop notifications: SSL ──────────────────────
      if (ssl.has_ssl) {
        const domain = site.server_names[0] ?? site.name;
        const daysLeft = realDaysValue !== null ? realDaysValue : ssl.days_remaining;
        const ns = loadNotificationSettings();
        const serverName = servers.find(s => s.id === serverId)?.name ?? serverId;

        if (daysLeft <= 0) {
          notifySslExpired({ serverId, serverName, domain, settings: ns });
        } else {
          notifySslExpiring({ serverId, serverName, domain, daysRemaining: daysLeft, settings: ns });
        }
      }
      // ────────────────────────────────────────────────────
    } catch {}
    finally { setLoading(false); }
  }, [serverId, site.config_path, site.server_names, site.name, servers]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDryRun = async () => {
    setDryRunLoading(true); setDryRunResult(null);
    try {
      const r = await sshInvoke<SslResult>("ssl_renewal_dry_run", { serverId });
      setDryRunResult(r);
    } catch (err) { setDryRunResult({ success: false, output: "", message: String(err) }); }
    finally { setDryRunLoading(false); }
  };

  const realDays = days !== null ? days : sslStatus?.days_remaining ?? 0;
  const isExpiringSoon = realDays > 0 && realDays < 30;

  const statusIcon = () => {
    if (loading) return <RefreshCw size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />;
    if (!sslStatus?.has_ssl) return <ShieldOff size={16} style={{ color: "var(--text-muted)" }} />;
    if (realDays <= 0) return <ShieldAlert size={16} style={{ color: "var(--accent-red)" }} />;
    if (isExpiringSoon) return <ShieldAlert size={16} style={{ color: "var(--accent-yellow)" }} />;
    return <ShieldCheck size={16} style={{ color: "var(--accent-green)" }} />;
  };

  const statusText = () => {
    if (loading) return "Проверка SSL...";
    if (!sslStatus?.has_ssl) return "SSL не установлен";
    if (realDays <= 0) return "Сертификат истёк";
    if (isExpiringSoon) return `Истекает через ${realDays} дней`;
    return "SSL активен";
  };

  return (
    <div className={styles.panel}>
      {/* Шапка */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>
          <Shield size={14} /> SSL — {site.name}
        </span>
        <button className={styles.closeBtn} onClick={onClose}><X size={14} /></button>
      </div>

      {/* Статус SSL */}
      <div className={styles.statusBlock}>
        <div className={styles.statusRow}>
          {statusIcon()}
          <span className={`${styles.statusText} ${
            !sslStatus?.has_ssl ? styles.statusNone :
            realDays <= 0 ? styles.statusExpired :
            isExpiringSoon ? styles.statusWarning :
            styles.statusOk
          }`}>
            {statusText()}
          </span>
          <button className={styles.refreshBtn} onClick={loadAll} disabled={loading} title="Обновить">
            <RefreshCw size={12} />
          </button>
        </div>

        {sslStatus?.has_ssl && (
          <div className={styles.certDetails}>
            {sslStatus.issuer && (
              <div className={styles.certRow}>
                <span className={styles.certKey}>Выдан:</span>
                <span className={styles.certVal}>{sslStatus.issuer}</span>
              </div>
            )}
            {sslStatus.not_after && (
              <div className={styles.certRow}>
                <span className={styles.certKey}>До:</span>
                <span className={`${styles.certVal} ${isExpiringSoon ? styles.warnText : ""}`}>
                  {sslStatus.not_after}
                  {realDays > 0 && ` (${realDays} дн.)`}
                </span>
              </div>
            )}
            {sslStatus.subject && (
              <div className={styles.certRow}>
                <span className={styles.certKey}>Домен:</span>
                <span className={styles.certVal}>{sslStatus.subject.replace(/.*CN\s*=\s*/, "")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Certbot */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Certbot</div>
        {certbotInfo ? (
          <div className={styles.certbotRow}>
            {certbotInfo.installed
              ? <><CheckCircle size={13} style={{ color: "var(--accent-green)" }} /> {certbotInfo.version}</>
              : <><XCircle size={13} style={{ color: "var(--text-muted)" }} /> Не установлен</>
            }
          </div>
        ) : (
          <span className={styles.muted}>Проверка...</span>
        )}
      </div>

      {/* Автопродление */}
      {certbotInfo?.installed && renewal && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Автопродление</div>
          <div className={styles.renewalRow}>
            {renewal.timer_active
              ? <><CheckCircle size={13} style={{ color: "var(--accent-green)" }} /> Включено</>
              : <><AlertTriangle size={13} style={{ color: "var(--accent-yellow)" }} /> Таймер не активен</>
            }
          </div>
          <div className={styles.dryRunRow}>
            <button className={styles.btnDryRun} onClick={handleDryRun} disabled={dryRunLoading}>
              <Play size={12} className={dryRunLoading ? "animate-spin" : ""} />
              Проверить продление (dry-run)
            </button>
          </div>
          {dryRunResult && (
            <div className={`${styles.dryRunResult} ${dryRunResult.success ? styles.resultOk : styles.resultErr}`}>
              {dryRunResult.success ? <CheckCircle size={12} /> : <XCircle size={12} />}
              {dryRunResult.message}
            </div>
          )}
        </div>
      )}

      {/* Форма получения / кнопка */}
      <div className={styles.section}>
        {!showObtainForm ? (
          <button
            className={`${styles.btnGetSsl} ${sslStatus?.has_ssl ? styles.btnRenewSsl : ""}`}
            onClick={() => setShowObtainForm(true)}
            disabled={!certbotInfo?.installed || loading}
            title={!certbotInfo?.installed ? "Certbot не установлен" : ""}
          >
            <Lock size={13} />
            {sslStatus?.has_ssl ? "Обновить сертификат" : "Получить SSL"}
          </button>
        ) : (
          <ObtainForm
            serverId={serverId}
            site={site}
            onSuccess={() => { setShowObtainForm(false); loadAll(); onReloadNeeded(); }}
            onCancel={() => setShowObtainForm(false)}
          />
        )}

        {!certbotInfo?.installed && (
          <p className={styles.noCertbotHint}>
            Certbot не установлен. Для установки:
            <code> apt install certbot python3-certbot-nginx</code>
          </p>
        )}
      </div>
    </div>
  );
}
