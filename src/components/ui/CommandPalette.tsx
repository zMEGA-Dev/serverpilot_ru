import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Server, Terminal, FolderOpen, Activity, ScrollText, Bot, Shield, Code2, Rocket, Settings, X } from "lucide-react";
import { useServersStore } from "../../stores/serversStore";
import { useUiStore } from "../../stores/uiStore";
import styles from "./CommandPalette.module.css";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { servers, selectServer } = useServersStore();
  const { closeCommandPalette } = useUiStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCommandPalette();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const goTo = (path: string) => {
    navigate(path);
    closeCommandPalette();
  };

  const navCategory = t("commandPalette.navigation");
  const serversCategory = t("commandPalette.servers");

  const allItems: PaletteItem[] = [
    { id: "dashboard",  label: t("nav.dashboard"),  icon: <Activity size={14} />,    action: () => goTo("/dashboard"),  category: navCategory },
    { id: "terminal",   label: t("nav.terminal"),   icon: <Terminal size={14} />,    action: () => goTo("/terminal"),   category: navCategory },
    { id: "files",      label: t("nav.files"),      icon: <FolderOpen size={14} />,  action: () => goTo("/files"),      category: navCategory },
    { id: "monitoring", label: t("nav.monitoring"), icon: <Activity size={14} />,    action: () => goTo("/monitoring"), category: navCategory },
    { id: "logs",       label: t("nav.logs"),       icon: <ScrollText size={14} />,  action: () => goTo("/logs"),       category: navCategory },
    { id: "ai",         label: t("nav.ai"),         icon: <Bot size={14} />,         action: () => goTo("/ai"),         category: navCategory },
    { id: "security",   label: t("nav.security"),   icon: <Shield size={14} />,      action: () => goTo("/security"),   category: navCategory },
    { id: "scripts",    label: t("nav.scripts"),    icon: <Code2 size={14} />,       action: () => goTo("/scripts"),    category: navCategory },
    { id: "deployment", label: t("nav.deployment"), icon: <Rocket size={14} />,      action: () => goTo("/deployment"), category: navCategory },
    { id: "settings",   label: t("nav.settings"),   icon: <Settings size={14} />,    action: () => goTo("/settings"),   category: navCategory },
    ...servers.map((s) => ({
      id: `server-${s.id}`,
      label: s.name,
      description: `${s.username}@${s.host}:${s.port}`,
      icon: <Server size={14} style={{ color: s.color }} />,
      action: () => {
        selectServer(s.id);
        goTo("/dashboard");
      },
      category: serversCategory,
    })),
  ];

  const filtered = query.trim()
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description?.toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

  const categories = Array.from(new Set(filtered.map((i) => i.category)));

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((v) => Math.min(v + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((v) => Math.max(v - 1, 0));
    } else if (e.key === "Enter") {
      filtered[selected]?.action();
    }
  };

  return (
    <div className={styles.overlay} onClick={closeCommandPalette}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
        <div className={styles.input}>
          <Search size={16} className={styles.inputIcon} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("commandPalette.placeholder")}
            className={styles.inputField}
          />
          {query && (
            <button className={styles.clearBtn} onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
          <kbd className={styles.escKbd}>ESC</kbd>
        </div>

        <div className={styles.results}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>{t("commandPalette.empty")}</div>
          ) : (
            categories.map((cat) => {
              const items = filtered.filter((i) => i.category === cat);
              const startIdx = filtered.indexOf(items[0]);
              return (
                <div key={cat}>
                  <div className={styles.categoryLabel}>{cat}</div>
                  {items.map((item, idx) => {
                    const globalIdx = startIdx + idx;
                    return (
                      <button
                        key={item.id}
                        className={`${styles.resultItem} ${
                          selected === globalIdx ? styles.resultItemSelected : ""
                        }`}
                        onClick={item.action}
                        onMouseEnter={() => setSelected(globalIdx)}
                      >
                        <span className={styles.resultIcon}>{item.icon}</span>
                        <span className={styles.resultLabel}>{item.label}</span>
                        {item.description && (
                          <span className={styles.resultDesc}>{item.description}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
