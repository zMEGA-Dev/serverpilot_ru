import React from "react";
import { useTranslation } from "react-i18next";
import { Search, Bell, RefreshCw, Plug, PlugZap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../../services/sshQueue";
import { useServersStore } from "../../stores/serversStore";
import { useUiStore } from "../../stores/uiStore";
import styles from "./Header.module.css";

export function Header() {
  const { t } = useTranslation();
  const { getSelectedServer, selectedServerId, connectionStatus, setConnectionStatus } =
    useServersStore();
  const { openCommandPalette, notifications } = useUiStore();

  const server = getSelectedServer();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;
  const unread = notifications.filter((n) => !n.read).length;

  const handleConnect = async () => {
    if (!selectedServerId) return;
    setConnectionStatus(selectedServerId, "connecting");
    try {
      await sshInvoke("connect_ssh", { serverId: selectedServerId });
      setConnectionStatus(selectedServerId, "online");
    } catch (err) {
      setConnectionStatus(selectedServerId, "error");
    }
  };

  const handleDisconnect = async () => {
    if (!selectedServerId) return;
    await sshInvoke("disconnect_ssh", { serverId: selectedServerId });
    setConnectionStatus(selectedServerId, "offline");
  };

  return (
    <header className={styles.header}>
      {/* Левая часть — текущий сервер */}
      <div className={styles.left}>
        {server ? (
          <div className={styles.serverInfo}>
            <span
              className={`status-dot ${
                status === "online"
                  ? "online"
                  : status === "connecting"
                  ? "warning"
                  : "offline"
              }`}
            />
            <span className={styles.serverName} style={{ color: server.color }}>
              {server.name}
            </span>
            <span className={styles.serverHost}>
              {server.username}@{server.host}:{server.port}
            </span>
          </div>
        ) : (
          <span className={styles.noServer}>{t("dashboard.selectServer")}</span>
        )}
      </div>

      {/* Правая часть — действия */}
      <div className={styles.right}>
        {/* Поиск / Command Palette */}
        <button
          className={styles.searchBtn}
          onClick={openCommandPalette}
          title="Ctrl+K"
        >
          <Search size={14} />
          <span className={styles.searchText}>{t("app.search")}...</span>
          <kbd className={styles.kbd}>Ctrl K</kbd>
        </button>

        {/* Кнопки подключения */}
        {server && (
          <>
            {status === "online" ? (
              <button
                className={`${styles.iconBtn} ${styles.dangerBtn}`}
                onClick={handleDisconnect}
                title={t("app.disconnect")}
              >
                <PlugZap size={15} />
              </button>
            ) : (
              <button
                className={`${styles.iconBtn} ${styles.primaryBtn}`}
                onClick={handleConnect}
                disabled={status === "connecting"}
                title={t("app.connect")}
              >
                {status === "connecting" ? (
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                ) : (
                  <Plug size={15} />
                )}
              </button>
            )}
          </>
        )}

        {/* Уведомления */}
        <button className={styles.iconBtn} title="Уведомления">
          <Bell size={15} />
          {unread > 0 && (
            <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span>
          )}
        </button>
      </div>
    </header>
  );
}
