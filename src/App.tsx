import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "./components/layout/MainLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DashboardPage } from "./pages/DashboardPage";
import { ServersPage } from "./pages/ServersPage";
import { TerminalPage } from "./pages/TerminalPage";
import { FilesPage } from "./pages/FilesPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { LogsPage } from "./pages/LogsPage";
import { AiPage } from "./pages/AiPage";
import { SecurityPage } from "./pages/SecurityPage";
import { ScriptsPage } from "./pages/ScriptsPage";
import { BackupsPage } from "./pages/BackupsPage";
import { DeploymentPage } from "./pages/DeploymentPage";
import { NginxPage } from "./pages/NginxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ProcessesPage } from "./pages/ProcessesPage";
import { Pm2Page } from "./pages/Pm2Page";
import { DockerPage } from "./pages/DockerPage";
import { useServersStore } from "./stores/serversStore";
import { getCurrentWindow, PhysicalSize, PhysicalPosition } from "@tauri-apps/api/window";

export default function App() {
  const { servers, loadServers, loading } = useServersStore();

  // Загрузка серверов + автоподключение при запуске
  useEffect(() => {
    const autoConnect = localStorage.getItem("auto_connect") !== "false"; // по умолчанию включено
    loadServers().then(() => {
      if (!autoConnect) return;
      const { servers, connectServer } = useServersStore.getState();
      for (const s of servers) void connectServer(s.id);
    });
  }, [loadServers]);

  // Восстановление темы при запуске
  useEffect(() => {
    const savedTheme = localStorage.getItem("app_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  // Сохранение и восстановление размера/позиции окна (Tauri)
  useEffect(() => {
    let unResized: (() => void) | undefined;
    let unMoved: (() => void) | undefined;
    const persist = async () => {
      try {
        const win = getCurrentWindow();
        const size = await win.outerSize();
        const pos = await win.outerPosition();
        localStorage.setItem("window_state", JSON.stringify({
          width: size.width, height: size.height, x: pos.x, y: pos.y,
        }));
      } catch { /* dev/browser: API недоступна */ }
    };
    (async () => {
      try {
        const win = getCurrentWindow();
        const saved = localStorage.getItem("window_state");
        if (saved) {
          const s = JSON.parse(saved);
          if (Number.isFinite(s.width) && Number.isFinite(s.height))
            await win.setSize(new PhysicalSize(s.width, s.height));
          if (Number.isFinite(s.x) && Number.isFinite(s.y))
            await win.setPosition(new PhysicalPosition(s.x, s.y));
        }
        unResized = await win.onResized(persist);
        unMoved = await win.onMoved(persist);
      } catch { /* dev/browser: API недоступна */ }
    })();
    return () => { unResized?.(); unMoved?.(); };
  }, []);

  // Wait for initial load
  if (loading && servers.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>
        <div className="spinner" />
        <span style={{ fontSize: 14 }}>Loading…</span>
      </div>
    );
  }

  // Если серверов нет — показываем онбординг
  const showOnboarding = servers.length === 0;

  return (
    <ErrorBoundary>
      <Routes>
        {showOnboarding ? (
          <Route path="*" element={<OnboardingPage />} />
        ) : (
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="servers" element={<ServersPage />} />
            <Route path="terminal" element={<TerminalPage />} />
            <Route path="files" element={<FilesPage />} />
            <Route path="processes" element={<ProcessesPage />} />
            <Route path="pm2" element={<Pm2Page />} />
            <Route path="docker" element={<DockerPage />} />
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="ai" element={<AiPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="scripts" element={<ScriptsPage />} />
            <Route path="backups" element={<BackupsPage />} />
            <Route path="deployment" element={<DeploymentPage />} />
            <Route path="nginx" element={<NginxPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        )}
      </Routes>
    </ErrorBoundary>
  );
}
