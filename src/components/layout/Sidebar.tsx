import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, Server, Terminal, FolderOpen,
  Activity, ScrollText, Bot, Shield, Code2, Rocket,
  Settings, Plus, Star, ChevronDown, ChevronRight,
  Circle, Cpu, Package, Container, Globe, Database,
} from "lucide-react";
import { useServersStore } from "../../stores/serversStore";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { to: "/dashboard",   icon: LayoutDashboard, key: "dashboard" },
  { to: "/terminal",    icon: Terminal,         key: "terminal" },
  { to: "/files",       icon: FolderOpen,       key: "files" },
  { to: "/processes",   icon: Cpu,              key: "processes" },
  { to: "/pm2",         icon: Package,          key: "pm2" },
  { to: "/docker",      icon: Container,        key: "docker" },
  { to: "/monitoring",  icon: Activity,         key: "monitoring" },
  { to: "/logs",        icon: ScrollText,       key: "logs" },
  { to: "/ai",          icon: Bot,              key: "ai" },
  { to: "/deployment",  icon: Rocket,           key: "deployment" },
  { to: "/nginx",       icon: Globe,            key: "nginx" },
  { to: "/security",    icon: Shield,           key: "security" },
  { to: "/scripts",     icon: Code2,            key: "scripts" },
  { to: "/backups",     icon: Database,         key: "backups" },
];

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { servers, selectedServerId, selectServer, connectionStatus } = useServersStore();
  const [serversExpanded, setServersExpanded] = useState(true);

  const handleServerClick = (id: string) => {
    selectServer(id);
    navigate("/dashboard");
  };

  const getStatusClass = (id: string) => {
    const status = connectionStatus[id];
    if (status === "online") return "online";
    if (status === "offline") return "offline";
    if (status === "connecting") return "warning";
    if (status === "error") return "offline";
    return "unknown";
  };

  return (
    <aside className={styles.sidebar}>
      {/* Логотип */}
      <div className={styles.brand}>
        <div className={styles.brandIcon}>SP</div>
        <div className={styles.brandText}>
          <span className={styles.brandName}>ServerPilot</span>
          <span className={styles.brandSuffix}>RU</span>
        </div>
      </div>

      {/* Добавить сервер */}
      <button
        className={styles.addServerBtn}
        onClick={() => navigate("/servers")}
        title={t("nav.addServer")}
      >
        <Plus size={14} />
        <span>{t("nav.addServer")}</span>
      </button>

      <div className={styles.scrollArea}>
        {/* Список серверов */}
        <div className={styles.section}>
          <button
            className={styles.sectionHeader}
            onClick={() => setServersExpanded((v) => !v)}
          >
            <span className={styles.sectionLabel}>{t("nav.servers").toUpperCase()}</span>
            {serversExpanded ? (
              <ChevronDown size={12} className={styles.chevron} />
            ) : (
              <ChevronRight size={12} className={styles.chevron} />
            )}
          </button>

          {serversExpanded && (
            <ul className={styles.serverList}>
              {servers.map((server) => (
                <li key={server.id}>
                  <button
                    className={`${styles.serverItem} ${
                      selectedServerId === server.id ? styles.serverItemActive : ""
                    }`}
                    onClick={() => handleServerClick(server.id)}
                    title={`${server.host}:${server.port}`}
                  >
                    <span
                      className={`status-dot ${getStatusClass(server.id)}`}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      className={styles.serverName}
                      style={{ color: server.color }}
                    >
                      {server.name}
                    </span>
                    {server.favorite && (
                      <Star size={10} className={styles.starIcon} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.divider} />

        {/* Навигация */}
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ to, icon: Icon, key }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
              }
            >
              <Icon size={16} className={styles.navIcon} />
              <span>{t(`nav.${key}`)}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Настройки внизу */}
      <div className={styles.footer}>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
          }
        >
          <Settings size={16} className={styles.navIcon} />
          <span>{t("nav.settings")}</span>
        </NavLink>
      </div>
    </aside>
  );
}
