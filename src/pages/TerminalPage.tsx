import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X, Terminal as TermIcon, AlertCircle } from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import { PtyTerminal } from "../features/terminal/PtyTerminal";
import styles from "./TerminalPage.module.css";

interface Tab {
  id: string;
  title: string;
  /** tabKey changes on reconnect → component is recreated */
  tabKey: string;
}

let counter = 1;

function makeTab(): Tab {
  const id = String(Date.now());
  return { id, title: `bash ${counter++}`, tabKey: id };
}

export function TerminalPage() {
  const { t } = useTranslation();
  const { selectedServerId, getSelectedServer, connectionStatus } = useServersStore();
  const server   = getSelectedServer();
  const status   = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [tabs, setTabs]         = useState<Tab[]>([makeTab()]);
  const [activeId, setActiveId] = useState(tabs[0].id);

  const handleAddTab = () => {
    const tab = makeTab();
    setTabs((p) => [...p, tab]);
    setActiveId(tab.id);
  };

  const handleCloseTab = (id: string) => {
    if (tabs.length === 1) return;
    const idx  = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeId === id) setActiveId(rest[Math.max(0, idx - 1)].id);
  };

  const handleTitle = useCallback((tabId: string, title: string) => {
    if (!title) return;
    setTabs((p) => p.map((t) => t.id === tabId ? { ...t, title: title.slice(0, 32) } : t));
  }, []);

  if (!server || !selectedServerId) {
    return (
      <div className={styles.empty}>
        <TermIcon size={40} className={styles.emptyIcon} />
        <h2>{t("terminal.title")}</h2>
        <p>{t("terminal.selectServerHint")}</p>
      </div>
    );
  }

  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <AlertCircle size={40} className={styles.emptyIcon} />
        <h2>{t("terminal.notConnected")}</h2>
        <p>{t("terminal.notConnectedHint")}</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          PTY terminal opens its own SSH connection
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${tab.id === activeId ? styles.tabActive : ""}`}
            onClick={() => setActiveId(tab.id)}
          >
            <TermIcon size={11} />
            <span className={styles.tabTitle}>{tab.title}</span>
            {tabs.length > 1 && (
              <span
                className={styles.tabClose}
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
              >
                <X size={10} />
              </span>
            )}
          </button>
        ))}

        <button className={styles.addTabBtn} onClick={handleAddTab} title={t("terminal.newTab")}>
          <Plus size={13} />
        </button>

        <span className={styles.hint}>
          nano · vim · htop · top
        </span>
      </div>

      <div className={styles.termArea}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={styles.termPane}
            style={{ display: tab.id === activeId ? "flex" : "none" }}
          >
            <PtyTerminal
              serverId={selectedServerId}
              tabKey={tab.tabKey}
              onTitleChange={(title) => handleTitle(tab.id, title)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
