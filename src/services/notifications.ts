/**
 * Сервис уведомлений ServerPilot RU
 * - Локальные системные уведомления Windows через Tauri
 * - Cooldown (anti-spam) — одно уведомление на переход через порог
 * - Настройки хранятся в localStorage
 * - Никаких облачных backend, никаких secrets в уведомлениях
 */

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

// ─── Настройки уведомлений ────────────────────────────

export interface NotificationSettings {
  enabled: boolean;
  serverOffline: boolean;
  highCpu: boolean;
  highRam: boolean;
  lowDisk: boolean;
  sslExpiring: boolean;
  backupError: boolean;
  backupSuccess: boolean;
  deployError: boolean;
  deploySuccess: boolean;
  // Пороги
  cpuThreshold: number;   // % (default 90)
  ramThreshold: number;   // % (default 90)
  diskThreshold: number;  // % (default 90)
  sslDaysThreshold: number; // дней (default 14)
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  serverOffline: true,
  highCpu: true,
  highRam: true,
  lowDisk: true,
  sslExpiring: true,
  backupError: true,
  backupSuccess: false,
  deployError: true,
  deploySuccess: false,
  cpuThreshold: 90,
  ramThreshold: 90,
  diskThreshold: 90,
  sslDaysThreshold: 14,
};

const SETTINGS_KEY = "sp_notification_settings";

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveNotificationSettings(s: NotificationSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ─── Cooldown / anti-spam ─────────────────────────────
// Хранит состояние для каждого (serverId + тип алерта)
// Уведомление отправляется только при переходе FALSE → TRUE
// После возврата ниже порога — состояние сбрасывается

type AlertKey = string; // `${serverId}:${type}`

const alertState = new Map<AlertKey, boolean>();

function shouldAlert(key: AlertKey, isTriggered: boolean): boolean {
  const prev = alertState.get(key) ?? false;
  alertState.set(key, isTriggered);
  // Уведомляем только при переходе false → true
  return !prev && isTriggered;
}

// Cooldown по времени — минимум 5 минут между одинаковыми уведомлениями
const lastNotifTime = new Map<AlertKey, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 минут

function cooldownOk(key: AlertKey): boolean {
  const last = lastNotifTime.get(key) ?? 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS) return false;
  lastNotifTime.set(key, now);
  return true;
}

// ─── Отправка уведомления ─────────────────────────────

let permissionGranted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted) return true;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    permissionGranted = granted;
    return granted;
  } catch {
    return false;
  }
}

async function notify(title: string, body: string): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;
  try {
    sendNotification({ title, body });
  } catch (err) {
    console.warn("[Notifications] failed to send:", err);
  }
}

// ─── Проверки ─────────────────────────────────────────

export async function checkServerOffline(serverId: string, serverName: string, isOffline: boolean) {
  const s = loadNotificationSettings();
  if (!s.enabled || !s.serverOffline) return;

  const key: AlertKey = `${serverId}:offline`;
  if (!shouldAlert(key, isOffline)) return;
  if (!cooldownOk(key)) return;

  await notify(
    "Сервер недоступен",
    `${serverName}\nПроверьте SSH-соединение.`
  );
}

export async function checkCpu(serverId: string, serverName: string, cpu: number) {
  const s = loadNotificationSettings();
  if (!s.enabled || !s.highCpu) return;

  const key: AlertKey = `${serverId}:cpu`;
  const triggered = cpu >= s.cpuThreshold;
  if (!shouldAlert(key, triggered)) return;
  if (!cooldownOk(key)) return;

  await notify(
    "Высокая загрузка CPU",
    `Сервер: ${serverName}\nCPU: ${cpu.toFixed(0)}%`
  );
}

export async function checkRam(serverId: string, serverName: string, ram: number) {
  const s = loadNotificationSettings();
  if (!s.enabled || !s.highRam) return;

  const key: AlertKey = `${serverId}:ram`;
  const triggered = ram >= s.ramThreshold;
  if (!shouldAlert(key, triggered)) return;
  if (!cooldownOk(key)) return;

  await notify(
    "Высокое использование RAM",
    `Сервер: ${serverName}\nRAM: ${ram.toFixed(0)}%`
  );
}

export async function checkDisk(serverId: string, serverName: string, disk: number) {
  const s = loadNotificationSettings();
  if (!s.enabled || !s.lowDisk) return;

  const key: AlertKey = `${serverId}:disk`;
  const triggered = disk >= s.diskThreshold;
  if (!shouldAlert(key, triggered)) return;
  if (!cooldownOk(key)) return;

  await notify(
    "Мало свободного места",
    `Сервер: ${serverName}\nДиск: ${disk.toFixed(0)}%`
  );
}

export async function checkSsl(serverId: string, serverName: string, domain: string, daysLeft: number) {
  const s = loadNotificationSettings();
  if (!s.enabled || !s.sslExpiring) return;

  const key: AlertKey = `${serverId}:ssl:${domain}`;
  const triggered = daysLeft >= 0 && daysLeft <= s.sslDaysThreshold;
  const expired = daysLeft < 0;

  if (!shouldAlert(key, triggered || expired)) return;
  if (!cooldownOk(key)) return;

  if (expired) {
    await notify("SSL-сертификат истёк!", `Сервер: ${serverName}\nДомен: ${domain}`);
  } else {
    await notify(
      "SSL-сертификат истекает",
      `Сервер: ${serverName}\nДомен: ${domain}\nОсталось: ${daysLeft} дн.`
    );
  }
}

export async function notifyBackup(serverName: string, success: boolean, detail: string) {
  const s = loadNotificationSettings();
  if (!s.enabled) return;
  if (success && !s.backupSuccess) return;
  if (!success && !s.backupError) return;

  if (success) {
    await notify("Резервная копия готова", `Сервер: ${serverName}\n${detail}`);
  } else {
    await notify("Ошибка резервной копии", `Сервер: ${serverName}\n${detail}`);
  }
}

export async function notifyDeploy(serverName: string, branch: string, success: boolean, commit?: string) {
  const s = loadNotificationSettings();
  if (!s.enabled) return;
  if (success && !s.deploySuccess) return;
  if (!success && !s.deployError) return;

  if (success) {
    await notify(
      "Деплой завершён",
      `${serverName} / ${branch}${commit ? `\nCommit: ${commit.slice(0, 7)}` : ""}`
    );
  } else {
    await notify("Деплой не удался", `${serverName} / ${branch}`);
  }
}
