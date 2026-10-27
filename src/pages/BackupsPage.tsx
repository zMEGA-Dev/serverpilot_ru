import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive, Plus, Download, Trash2, RefreshCw,
  AlertTriangle, CheckCircle, XCircle, Clock,
  Search, X, HardDrive, Server,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { sshInvoke } from "../services/sshQueue";
import { useServersStore } from "../stores/serversStore";
import type { Backup, BackupSpaceInfo, BackupResult } from "../types";
import {
  loadNotificationSettings,
  notifyBackupFailed,
} from "../services/notificationsService";
import styles from "./BackupsPage.module.css";

// ─── Утилиты ──────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Б";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} МБ`;
  return `${(bytes / 1_073_741_824).toFixed(2)} ГБ`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

function statusBadge(status: Backup["status"]) {
  switch (status) {
    case "creating":    return { label: "Creating",    color: "var(--accent-blue)",   icon: <RefreshCw size={11} className="animate-spin" /> };
    case "ready":       return { label: "Ready",       color: "var(--accent-green)",  icon: <CheckCircle size={11} /> };
    case "downloading": return { label: "Downloading", color: "var(--accent-yellow)", icon: <Download size={11} /> };
    case "deleted":     return { label: "Deleted",     color: "var(--text-muted)",    icon: <Trash2 size={11} /> };
    case "error":       return { label: "Error",       color: "var(--accent-red)",    icon: <XCircle size={11} /> };
  }
}

// ─── Форма создания backup ────────────────────────────

interface CreateFormProps {
  onClose: () => void;
  onCreated: (backup: BackupResult) => void;
}

function CreateForm({ onClose, onCreated }: CreateFormProps) {
  const { servers, connectionStatus } = useServersStore();
  const onlineServers = servers.filter(s => connectionStatus[s.id] === "online");

  const [serverId, setServerId] = useState(onlineServers[0]?.id ?? "");
  const [source, setSource]     = useState("");
  const [spaceInfo, setSpaceInfo] = useState<BackupSpaceInfo | null>(null);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState("");
  const [confirmed, setConfirmed] = useState(false); // для системных директорий

  const checkSpace = useCallback(async () => {
    if (!serverId || !source.trim()) return;
    setSpaceLoading(true);
    try {
      const info = await sshInvoke<BackupSpaceInfo>("backup_check_space", {
        serverId, sourcePath: source.trim(),
      });
      setSpaceInfo(info);
    } catch { setSpaceInfo(null); }
    finally { setSpaceLoading(false); }
  }, [serverId, source]);

  const handleCreate = async () => {
    if (!serverId) { setError("Выберите сервер"); return; }
    if (!source.trim()) { setError("Укажите источник"); return; }
    if (spaceInfo?.is_system_dir && !confirmed) { setConfirmed(true); return; }

    setCreating(true); setError("");
    try {
      const result = await sshInvoke<BackupResult>("backup_create", {
        serverId,
        serverName: servers.find(s => s.id === serverId)?.name ?? serverId,
        sourcePath: source.trim(),
      });
      if (result.success) {
        onCreated(result);
        onClose();
      } else {
        setError(result.message);
        // ── Desktop notification: backup failed ──────────────
        const serverName = servers.find(s => s.id === serverId)?.name ?? serverId;
        const ns = loadNotificationSettings();
        notifyBackupFailed({
          serverId,
          serverName,
          sourcePath: source.trim(),
          message: result.message,
          settings: ns,
        });
        // ────────────────────────────────────────────────────
      }
    } catch (err) {
      setError(String(err));
      // ── Desktop notification: backup failed (exception) ──
      const serverName = servers.find(s => s.id === serverId)?.name ?? serverId;
      const ns = loadNotificationSettings();
      notifyBackupFailed({
        serverId,
        serverName,
        sourcePath: source.trim(),
        message: String(err),
        settings: ns,
      });
      // ────────────────────────────────────────────────────
    }
    finally { setCreating(false); }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.formDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.formTitle}>
          <Archive size={15} /> Создать резервную копию
        </div>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label>Сервер</label>
            {onlineServers.length === 0 ? (
              <div className={styles.noServers}>Нет подключённых серверов</div>
            ) : (
              <select className={styles.inp} value={serverId} onChange={e => setServerId(e.target.value)}>
                {onlineServers.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.field}>
            <label>Источник (путь на сервере)</label>
            <input className={styles.inp} value={source}
              onChange={e => { setSource(e.target.value); setSpaceInfo(null); setConfirmed(false); }}
              onBlur={checkSpace}
              placeholder="/var/www/example.com" />
          </div>
        </div>

        {/* Информация о месте */}
        {spaceLoading && (
          <div className={styles.spaceLoading}><RefreshCw size={12} className="animate-spin" /> Проверка...</div>
        )}
        {spaceInfo && (
          <div className={`${styles.spaceInfo} ${!spaceInfo.has_enough_space ? styles.spaceWarn : styles.spaceOk}`}>
            <div className={styles.spaceRow}>
              <HardDrive size={13} />
              <span>Источник: <strong>{spaceInfo.source_size_human}</strong></span>
              <span>Свободно на /tmp: <strong>{spaceInfo.free_human}</strong></span>
            </div>
            {!spaceInfo.has_enough_space && (
              <div className={styles.spaceAlert}>
                <AlertTriangle size={12} /> Возможно недостаточно свободного места
              </div>
            )}
          </div>
        )}

        {/* Предупреждение системной директории */}
        {confirmed && spaceInfo?.is_system_dir && (
          <div className={styles.sysWarn}>
            <AlertTriangle size={14} style={{ flexShrink: 0, color: "var(--accent-yellow)" }} />
            <div>
              <strong>Системная директория</strong>
              <p>Это может занять много времени и места.</p>
            </div>
          </div>
        )}

        {error && (
          <div className={styles.formError}><AlertTriangle size={12} /> {error}</div>
        )}

        <div className={styles.formActions}>
          <button className={styles.btnCancel} onClick={onClose}>Отмена</button>
          <button
            className={styles.btnCreate}
            onClick={handleCreate}
            disabled={creating || !serverId || !source.trim()}
          >
            {creating
              ? <><RefreshCw size={13} className="animate-spin" /> Архивирование...</>
              : confirmed && spaceInfo?.is_system_dir
              ? <><Archive size={13} /> Продолжить</>
              : <><Archive size={13} /> Создать</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Диалог удаления с сервера ────────────────────────

interface DeleteRemoteDialogProps {
  backup: Backup;
  onDelete: () => void;
  onKeep: () => void;
}

function DeleteRemoteDialog({ backup, onDelete, onKeep }: DeleteRemoteDialogProps) {
  return (
    <div className={styles.overlay} onClick={onKeep}>
      <div className={styles.smallDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.formTitle}>Удалить временный архив?</div>
        <p className={styles.dialogMsg}>
          Архив <code>{backup.archive_name}</code> будет удалён с сервера.
          <br />Исходные файлы не затронуты.
        </p>
        <div className={styles.formActions}>
          <button className={styles.btnCancel} onClick={onKeep}>Оставить</button>
          <button className={styles.btnDelete} onClick={onDelete}>Удалить</button>
        </div>
      </div>
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────

export function BackupsPage() {
  const { t } = useTranslation();
  const { servers } = useServersStore();
  const [backups, setBackups]         = useState<Backup[]>([]);
  const [search, setSearch]           = useState("");
  const [filterServer, setFilterServer] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreate, setShowCreate]   = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteRemote, setDeleteRemote] = useState<Backup | null>(null);
  const [statusMsg, setStatusMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  const loadBackups = useCallback(() => {
    invoke<Backup[]>("backup_list").then(setBackups).catch(() => {});
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // ─ Скачать ─
  const handleDownload = async (backup: Backup) => {
    setDownloading(backup.id);
    try {
      const [b64, filename] = await sshInvoke<[string, string]>("backup_download", {
        serverId: backup.server_id,
        backupId: backup.id,
      });

      // Декодируем base64 → байты
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

      // Сохраняем через диалог
      const savePath = await saveDialog({ defaultPath: filename });
      if (savePath) {
        await writeFile(savePath, bytes);
        showStatus(`«${filename}» сохранён локально`);
        loadBackups();
        // Предлагаем удалить архив с сервера
        setDeleteRemote(backup);
      }
    } catch (err) {
      showStatus(`Ошибка скачивания: ${err}`, false);
    } finally {
      setDownloading(null);
    }
  };

  // ─ Удалить с сервера ─
  const handleDeleteRemote = async () => {
    if (!deleteRemote) return;
    const b = deleteRemote;
    setDeleteRemote(null);
    try {
      await sshInvoke("backup_delete_remote", {
        serverId: b.server_id,
        backupId: b.id,
      });
      showStatus("Архив удалён с сервера");
      loadBackups();
    } catch (err) {
      showStatus(`Ошибка удаления: ${err}`, false);
    }
  };

  // ─ Удалить запись из истории ─
  const handleDeleteRecord = async (backup: Backup) => {
    try {
      await invoke("backup_delete_record", { backupId: backup.id });
      showStatus("Запись удалена из истории");
      loadBackups();
    } catch (err) { showStatus(String(err), false); }
  };

  // ─ Фильтрация ─
  const uniqueServers = useMemo(() =>
    [...new Map(backups.map(b => [b.server_id, b.server_name])).entries()],
    [backups]
  );

  const filtered = useMemo(() => {
    let list = backups;
    if (filterServer !== "all") list = list.filter(b => b.server_id === filterServer);
    if (filterStatus !== "all") list = list.filter(b => b.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b =>
        b.source_path.toLowerCase().includes(q) ||
        b.archive_name.toLowerCase().includes(q) ||
        b.server_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [backups, filterServer, filterStatus, search]);

  return (
    <div className={styles.page}>
      {/* Шапка */}
      <div className={styles.header}>
        <h1><Archive size={18} /> {t("backups.title")}</h1>
        <div className={styles.headerRight}>
          <div className={styles.searchBox}>
            <Search size={13} className={styles.searchIcon} />
            <input className={styles.searchInput} value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("app.search")} />
            {search && <button className={styles.searchClear} onClick={() => setSearch("")}><X size={12} /></button>}
          </div>
          <button className={styles.newBtn} onClick={() => setShowCreate(true)}>
            <Plus size={13} /> {t("backups.create")}
          </button>
          <button className={styles.refreshBtn} onClick={loadBackups} title={t("app.refresh")}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Статус */}
      {statusMsg && (
        <div className={`${styles.statusBar} ${statusMsg.ok ? styles.statusOk : styles.statusErr}`}>
          {statusMsg.text}
        </div>
      )}

      {/* Фильтры */}
      {backups.length > 0 && (
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={filterServer}
            onChange={e => setFilterServer(e.target.value)}>
            <option value="all">Все серверы</option>
            {uniqueServers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select className={styles.filterSelect} value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">Все статусы</option>
            <option value="ready">Готов</option>
            <option value="error">Ошибка</option>
            <option value="deleted">Удалён</option>
          </select>
        </div>
      )}

      {/* Список */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Archive size={48} style={{ opacity: 0.2 }} />
          {backups.length === 0 ? (
            <>
              <h2>{t("backups.noBackups")}</h2>
              <p>{t("backups.noBackupsHint")}</p>
            </>
          ) : (
            <p>{t("app.search")}: 0</p>
          )}
        </div>
      ) : (
        <div className={styles.backupsList}>
          {filtered.map(backup => {
            const badge = statusBadge(backup.status);
            const isDownloading = downloading === backup.id;

            return (
              <div key={backup.id} className={styles.backupCard}>
                <div className={styles.backupTop}>
                  <div className={styles.backupInfo}>
                    <div className={styles.backupSource}>{backup.source_path}</div>
                    <div className={styles.backupMeta}>
                      <span className={styles.metaItem}>
                        <Server size={11} /> {backup.server_name}
                      </span>
                      <span className={styles.metaItem}>
                        <Archive size={11} /> {backup.archive_name}
                      </span>
                      {backup.size_bytes > 0 && (
                        <span className={styles.metaItem}>
                          <HardDrive size={11} /> {formatBytes(backup.size_bytes)}
                        </span>
                      )}
                      <span className={styles.metaItem}>
                        <Clock size={11} /> {formatDate(backup.created_at)}
                      </span>
                      {backup.downloaded_at && (
                        <span className={styles.metaItem} style={{ color: "var(--accent-green)" }}>
                          <Download size={11} /> Скачан: {formatDate(backup.downloaded_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.backupRight}>
                    <span className={styles.statusBadge} style={{ color: badge.color }}>
                      {badge.icon} {badge.label}
                    </span>
                    <div className={styles.backupActions}>
                      {backup.status === "ready" && (
                        <button
                          className={styles.downloadBtn}
                          onClick={() => handleDownload(backup)}
                          disabled={isDownloading || !!downloading}
                          title="Скачать"
                        >
                          {isDownloading
                            ? <><RefreshCw size={12} className="animate-spin" /> Скачивается...</>
                            : <><Download size={12} /> Скачать</>
                          }
                        </button>
                      )}
                      <button
                        className={styles.deleteRecordBtn}
                        onClick={() => handleDeleteRecord(backup)}
                        title="Удалить из истории"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Ошибка */}
                {backup.status === "error" && backup.error_message && (
                  <div className={styles.errorMsg}>
                    <XCircle size={12} /> {backup.error_message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Форма создания */}
      {showCreate && (
        <CreateForm
          onClose={() => setShowCreate(false)}
          onCreated={(result) => {
            showStatus(result.message);
            loadBackups();
          }}
        />
      )}

      {/* Диалог удаления с сервера */}
      {deleteRemote && (
        <DeleteRemoteDialog
          backup={deleteRemote}
          onDelete={handleDeleteRemote}
          onKeep={() => setDeleteRemote(null)}
        />
      )}
    </div>
  );
}
