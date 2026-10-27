import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Plus, Edit2, Trash2, Star, Server, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useServersStore } from "../stores/serversStore";
import type { CreateServerRequest, AuthType, Server as ServerType, UpdateServerRequest } from "../types";
import styles from "./ServersPage.module.css";

export function ServersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { servers, addServer, deleteServer, updateServer, selectServer, connectionStatus } =
    useServersStore();
  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = (server: ServerType) => {
    setDeleteTarget(server);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteServer(deleteTarget.id);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleToggleFavorite = async (s: ServerType) => {
    await updateServer({ id: s.id, favorite: !s.favorite });
  };

  const openEdit = (server: ServerType) => {
    setEditingServer(server);
    setShowForm(true);
  };

  const openAdd = () => {
    setEditingServer(null);
    setShowForm(true);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>{t("servers.title")}</h1>
        <button className={styles.addBtn} onClick={openAdd}>
          <Plus size={14} />
          {t("servers.add")}
        </button>
      </div>

      {servers.length === 0 ? (
        <div className={styles.empty}>
          <Server size={40} />
          <p>{t("servers.noServers")}</p>
          <span>{t("servers.noServersHint")}</span>
        </div>
      ) : (
        <div className={styles.grid}>
          {servers.map((server) => {
            const status = connectionStatus[server.id];
            return (
              <div key={server.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={`status-dot ${
                    status === "online" ? "online" :
                    status === "connecting" ? "warning" : "unknown"
                  }`} />
                  <span className={styles.cardName} style={{ color: server.color }}>
                    {server.name}
                  </span>
                  <button
                    className={`${styles.iconBtn} ${server.favorite ? styles.favActive : ""}`}
                    onClick={() => handleToggleFavorite(server)}
                    title={t("servers.favorite")}
                  >
                    <Star size={13} />
                  </button>
                </div>

                <div className={styles.cardMeta}>
                  <span className={styles.metaRow}>
                    {server.username}@{server.host}:{server.port}
                  </span>
                  <span className={`tag`}>
                    {server.auth_type === "password" ? t("servers.authPassword") :
                     server.auth_type === "key" ? t("servers.authKey") : t("servers.authAgent")}
                  </span>
                  {server.group_name && <span className="tag">{server.group_name}</span>}
                  {server.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
                </div>

                {server.description && (
                  <p className={styles.cardDesc}>{server.description}</p>
                )}

                <div className={styles.cardActions}>
                  <button className={styles.actionBtn} onClick={() => { selectServer(server.id); navigate("/dashboard"); }}>
                    <Server size={13} />
                    {t("servers.open")}
                  </button>
                  <button className={styles.actionBtn} onClick={() => openEdit(server)} title={t("app.edit")}>
                    <Edit2 size={13} />
                    {t("app.edit")}
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.dangerBtn}`}
                    onClick={() => handleDelete(server)}
                    title={t("app.delete")}
                    disabled={deleting && deleteTarget?.id === server.id}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Диалог подтверждения удаления */}
      {deleteTarget && (
        <div className={styles.confirmOverlay} onClick={() => !deleting && setDeleteTarget(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmTitle}>
              <AlertTriangle size={16} style={{ color: "var(--accent-red)" }} />
              {t("servers.deleteTitle")}
            </div>
            <p className={styles.confirmMsg}>
              <strong>{deleteTarget.name}</strong> ({deleteTarget.username}@{deleteTarget.host}) {t("servers.deleteConfirmMsg")}
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                {t("app.cancel")}
              </button>
              <button
                className={styles.deleteConfirmBtn}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? t("servers.deleting") : t("app.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <ServerFormModal
          server={editingServer}
          onClose={() => { setShowForm(false); setEditingServer(null); }}
          onSaved={() => { setShowForm(false); setEditingServer(null); }}
        />
      )}
    </div>
  );
}

// ===== Форма добавления / редактирования сервера =====
interface ServerFormProps {
  server: ServerType | null;
  onClose: () => void;
  onSaved: () => void;
}

function ServerFormModal({ server, onClose, onSaved }: ServerFormProps) {
  const { t } = useTranslation();
  const { addServer, updateServer } = useServersStore();

  const isEdit = server !== null;

  // Основные поля — берём из сервера если редактируем
  const [name, setName]               = useState(server?.name ?? "");
  const [host, setHost]               = useState(server?.host ?? "");
  const [port, setPort]               = useState(server?.port ?? 22);
  const [username, setUsername]       = useState(server?.username ?? "root");
  const [authType, setAuthType]       = useState<AuthType>(server?.auth_type ?? "password");
  const [keyPath, setKeyPath]         = useState(server?.key_path ?? "");
  const [color, setColor]             = useState(server?.color ?? "#4f8ef7");
  const [description, setDescription] = useState(server?.description ?? "");
  const [groupName, setGroupName]     = useState(server?.group_name ?? "");
  const [favorite, setFavorite]       = useState(server?.favorite ?? false);

  // Credentials — пустые по умолчанию (при редактировании оставляем пустыми = не меняем)
  const [password, setPassword]       = useState("");
  const [passphrase, setPassphrase]   = useState("");
  const [changeCredentials, setChangeCredentials] = useState(!isEdit);

  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  // Снимок начальных значений — для отслеживания несохранённых изменений (dirty state)
  const initial = {
    name: server?.name ?? "",
    host: server?.host ?? "",
    port: server?.port ?? 22,
    username: server?.username ?? "root",
    authType: server?.auth_type ?? "password",
    keyPath: server?.key_path ?? "",
    color: server?.color ?? "#4f8ef7",
    description: server?.description ?? "",
    groupName: server?.group_name ?? "",
    favorite: server?.favorite ?? false,
    password: "",
    passphrase: "",
    changeCredentials: !isEdit,
  };
  const isDirty =
    name !== initial.name ||
    host !== initial.host ||
    port !== initial.port ||
    username !== initial.username ||
    authType !== initial.authType ||
    keyPath !== initial.keyPath ||
    color !== initial.color ||
    description !== initial.description ||
    groupName !== initial.groupName ||
    favorite !== initial.favorite ||
    password !== initial.password ||
    passphrase !== initial.passphrase ||
    changeCredentials !== initial.changeCredentials;

  // Escape закрывает форму (с подтверждением, если есть несохранённые изменения)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDirty && !window.confirm(t("servers.unsavedChangesConfirm"))) return;
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDirty, onClose, t]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const params = {
        server_id: "test",
        host,
        port,
        username,
        auth_type: authType,
        password: authType === "password" && changeCredentials ? password : undefined,
        key_path: authType === "key" ? keyPath : undefined,
        key_passphrase: authType === "key" && changeCredentials ? passphrase : undefined,
      };
      const result = await invoke<{ success: boolean; error?: string; fingerprint?: string }>(
        "test_ssh_connection", { request: params }
      );
      setTestResult({
        ok: result.success,
        msg: result.success
          ? `✓ ${t("servers.connectionSuccess")}${result.fingerprint ? ` · ${result.fingerprint.slice(0, 24)}...` : ""}`
          : (result.error ?? t("servers.connectionFailed")),
      });
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !host.trim() || !username.trim()) {
      setError(t("servers.requiredFields"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isEdit && server) {
        // Обновляем основные данные
        const req: UpdateServerRequest = {
          id: server.id,
          name, host, port, username,
          key_path: authType === "key" ? keyPath : undefined,
          group_name: groupName || undefined,
          description,
          color,
          favorite,
        };
        await updateServer(req);

        // Если пользователь хочет изменить credentials
        if (changeCredentials && (password || passphrase)) {
          await invoke("update_server_credentials", {
            serverId: server.id,
            password: authType === "password" ? password : null,
            keyPassphrase: authType === "key" ? passphrase : null,
          });
        }
      } else {
        // Новый сервер
        const req: CreateServerRequest = {
          name, host, port, username,
          auth_type: authType,
          password: authType === "password" ? password : undefined,
          key_path: authType === "key" ? keyPath : undefined,
          key_passphrase: authType === "key" ? passphrase : undefined,
          group_name: groupName || undefined,
          description,
          color,
          favorite,
        };
        await addServer(req);
      }
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={() => { if (!isDirty) onClose(); }}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? `${t("servers.edit")}: ${server!.name}` : t("servers.add")}</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.modalBody}>
          {/* Название + цвет */}
          <div className={styles.row}>
            <div className={styles.field} style={{ flex: 3 }}>
              <label>{t("servers.name")} *</label>
              <input className={styles.inp} value={name}
                onChange={(e) => setName(e.target.value)} placeholder="prod-web" />
            </div>
            <div className={styles.field} style={{ width: 56 }}>
              <label>{t("servers.color")}</label>
              <input type="color" className={styles.colorInput}
                value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>

          {/* Хост + порт */}
          <div className={styles.row}>
            <div className={styles.field} style={{ flex: 3 }}>
              <label>{t("servers.host")} *</label>
              <input className={styles.inp} value={host}
                onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10" />
            </div>
            <div className={styles.field} style={{ flex: 1 }}>
              <label>{t("servers.port")}</label>
              <input type="number" className={styles.inp} value={port}
                onChange={(e) => setPort(Number(e.target.value))} />
            </div>
          </div>

          {/* Пользователь */}
          <div className={styles.field}>
            <label>{t("servers.username")} *</label>
            <input className={styles.inp} value={username}
              onChange={(e) => setUsername(e.target.value)} placeholder="root" />
          </div>

          {/* Тип аутентификации */}
          {!isEdit && (
            <div className={styles.field}>
              <label>{t("servers.authentication")}</label>
              <div className={styles.authTabs}>
                {(["password", "key", "agent"] as AuthType[]).map((type) => (
                  <button key={type}
                    className={`${styles.authTab} ${authType === type ? styles.authTabActive : ""}`}
                    onClick={() => setAuthType(type)}>
                    {type === "password" ? t("servers.authPassword") : type === "key" ? t("servers.authKey") : t("servers.authAgent")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SSH ключ (всегда показываем при auth_type=key) */}
          {(isEdit ? server!.auth_type === "key" : authType === "key") && (
            <div className={styles.field}>
              <label>{t("servers.keyPath")}</label>
              <input className={styles.inp} value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="C:\Users\you\.ssh\id_rsa" />
            </div>
          )}

          {/* При редактировании — кнопка изменить credentials */}
          {isEdit && (
            <div className={styles.credSection}>
              <div className={styles.credHeader}>
                <span className={styles.credLabel}>
                  {t("servers.authType")}: {server!.auth_type === "password" ? t("servers.authPassword") :
                        server!.auth_type === "key" ? t("servers.authKey") : t("servers.authAgent")}
                </span>
                <button
                  className={`${styles.changeCredBtn} ${changeCredentials ? styles.changeCredActive : ""}`}
                  onClick={() => setChangeCredentials((v) => !v)}
                >
                  {changeCredentials ? t("servers.changingCredentials") : t("servers.changeCredentials")}
                </button>
              </div>

              {changeCredentials && server!.auth_type === "password" && (
                <div className={styles.field}>
                  <label>{t("servers.newPasswordLabel")}</label>
                  <input type="password" className={styles.inp} value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
              )}

              {changeCredentials && server!.auth_type === "key" && (
                <div className={styles.field}>
                  <label>{t("servers.newPassphraseLabel")}</label>
                  <input type="password" className={styles.inp} value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)} placeholder="••••••••" />
                </div>
              )}
            </div>
          )}

          {/* Новый сервер — credentials */}
          {!isEdit && authType === "password" && (
            <div className={styles.field}>
              <label>{t("servers.authPassword")}</label>
              <input type="password" className={styles.inp} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}

          {!isEdit && authType === "key" && (
            <div className={styles.field}>
              <label>{t("servers.passphrase")} ({t("app.optional")})</label>
              <input type="password" className={styles.inp} value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)} placeholder="••••••••" />
            </div>
          )}

          {!isEdit && authType === "agent" && (
            <p className={styles.agentHint}>
              {t("servers.agentHint")}
            </p>
          )}

          {/* Доп. поля */}
          <div className={styles.row}>
            <div className={styles.field} style={{ flex: 1 }}>
              <label>{t("servers.group")}</label>
              <input className={styles.inp} value={groupName}
                onChange={(e) => setGroupName(e.target.value)} placeholder="production" />
            </div>
            <div className={styles.field} style={{ flex: 2 }}>
              <label>{t("servers.description")}</label>
              <input className={styles.inp} value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("servers.descriptionPlaceholder")} />
            </div>
          </div>

          <label className={styles.checkRow}>
            <input type="checkbox" checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)} />
            {t("servers.favorite")}
          </label>

          {testResult && (
            <div className={`${styles.testResult} ${testResult.ok ? styles.testOk : styles.testFail}`}>
              {testResult.msg}
            </div>
          )}

          {error && (
            <div className={styles.testResult + " " + styles.testFail}>{error}</div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.testBtn} onClick={handleTest} disabled={testing || !host}>
            {testing ? t("servers.testingConnection") : t("servers.testConnection")}
          </button>
          <div style={{ flex: 1 }} />
          <button className={styles.cancelBtn} onClick={onClose}>{t("app.cancel")}</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? t("app.saving") : t("app.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
