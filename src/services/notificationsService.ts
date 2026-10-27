/**
 * Desktop Notifications Service — ServerPilot RU
 *
 * Обёртка над tauri-plugin-notification.
 * Содержит:
 * - anti-spam (cooldown per alert key)
 * - edge-trigger для непрерывных метрик (CPU/RAM/Disk)
 * - загрузку/сохранение настроек из localStorage
 * - deep-link через action при клике на уведомление
 *
 * Никогда не отправляет данные во внешние сервисы.
 * Не включает в уведомления пароли, ключи, токены.
 */

import { sendNotification } from "@tauri-apps/plugin-notification";

// ─── Типы настроек ────────────────────────────────────

export interface NotificationSettings {
  enabled: boolean;

  // Переключатели по типам
  serverOffline: boolean;
  cpuHigh: boolean;
  ramHigh: boolean;
  diskHigh: boolean;
  sslExpiring: boolean;
  sslExpired: boolean;
  backupFailed: boolean;
  deployFailed: boolean;
  deploySuccess: boolean;

  // Пороги
  cpuThreshold: number;   // % (0–100)
  ramThreshold: number;   // % (0–100)
  diskThreshold: number;  // % (0–100)
  sslDaysThreshold: number; // дней до истечения
}

const SETTINGS_KEY = "notification_settings";

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,

  serverOffline: true,
  cpuHigh: true,
  ramHigh: true,
  diskHigh: true,
  sslExpiring: true,
  sslExpired: true,
  backupFailed: true,
  deployFailed: true,
  deploySuccess: false,

  cpuThreshold: 90,
  ramThreshold: 90,
  diskThreshold: 90,
  sslDaysThreshold: 14,
};

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveNotificationSettings(s: NotificationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ─── Anti-spam ────────────────────────────────────────
//
// Каждый «тип события + serverId» имеет своё состояние.
// Для edge-trigger метрик (CPU/RAM/Disk):
//   – при первом превышении порога → уведомление + fired=true
//   – пока выше порога и fired=true → тишина
//   – когда опустился ниже порога → fired=false (сброс)
//   – при новом превышении → новое уведомление
//
// Для one-shot событий (offline, backup, deploy, ssl):
//   – cooldown в миллисекундах (по умолчанию 30 мин)
//   – новое уведомление только если cooldown истёк

interface EdgeState {
  fired: boolean;
}

interface CooldownState {
  lastFiredAt: number; // Date.now()
}

// Ключ → состояние
const edgeStates = new Map<string, EdgeState>();
const cooldownStates = new Map<string, CooldownState>();

// Cooldown для one-shot событий — 30 мин
const ONE_SHOT_COOLDOWN_MS = 30 * 60 * 1000;

// ─── Низкоуровневая отправка ──────────────────────────

async function dispatch(title: string, body: string): Promise<void> {
  try {
    await sendNotification({ title, body });
  } catch (err) {
    // В dev-режиме может не быть прав — логируем без краша
    console.warn("[Notifications] sendNotification failed:", err);
  }
}

// ─── Edge-trigger API (CPU/RAM/Disk) ─────────────────

/**
 * Вызывается при каждом тике мониторинга.
 * Возвращает true если уведомление было отправлено.
 */
export async function checkThreshold(opts: {
  serverId: string;
  serverName: string;
  metricKey: "cpu" | "ram" | "disk";
  value: number;
  threshold: number;
  enabled: boolean;
  globalEnabled: boolean;
  /** Отображаемое имя метрики */
  metricLabel: string;
  /** Навигационный path — используется как суффикс тела уведомления */
  hint?: string;
}): Promise<boolean> {
  const {
    serverId, serverName, metricKey, value, threshold,
    enabled, globalEnabled, metricLabel, hint,
  } = opts;

  const key = `${metricKey}:${serverId}`;
  const state = edgeStates.get(key) ?? { fired: false };

  if (value >= threshold) {
    if (!state.fired && enabled && globalEnabled) {
      state.fired = true;
      edgeStates.set(key, state);
      const body = `${serverName}: ${metricLabel} ${Math.round(value)}% (порог ${threshold}%)${hint ? `. ${hint}` : ""}`;
      await dispatch(`ServerPilot — высокая нагрузка`, body);
      return true;
    }
    // Обновляем состояние (оставляем fired=true)
    edgeStates.set(key, state);
  } else {
    // Ниже порога — сбрасываем
    if (state.fired) {
      state.fired = false;
      edgeStates.set(key, state);
    }
  }
  return false;
}

/** Сбросить edge-state для сервера (например, при отключении) */
export function resetEdgeStates(serverId: string): void {
  for (const key of ["cpu", "ram", "disk"]) {
    edgeStates.delete(`${key}:${serverId}`);
  }
}

// ─── One-shot API ─────────────────────────────────────

async function oneShotNotify(
  key: string,
  title: string,
  body: string,
  cooldownMs: number = ONE_SHOT_COOLDOWN_MS,
): Promise<boolean> {
  const state = cooldownStates.get(key);
  const now = Date.now();
  if (state && now - state.lastFiredAt < cooldownMs) return false;
  cooldownStates.set(key, { lastFiredAt: now });
  await dispatch(title, body);
  return true;
}

// ─── Server offline ───────────────────────────────────

/**
 * Вызывать при каждом изменении статуса сервера.
 * Уведомление только при переходе online → offline.
 */
export async function notifyServerOffline(opts: {
  serverId: string;
  serverName: string;
  settings: NotificationSettings;
}): Promise<boolean> {
  const { serverId, serverName, settings } = opts;
  if (!settings.enabled || !settings.serverOffline) return false;

  // Ключ специфичен для offline-события этого сервера
  const key = `server_offline:${serverId}`;
  return oneShotNotify(
    key,
    `ServerPilot — сервер недоступен`,
    `${serverName} перестал отвечать. Проверьте соединение.`,
    // Для offline — более короткий cooldown (5 мин), чтобы уведомить
    // заново если сервер снова упал после восстановления
    5 * 60 * 1000,
  );
}

/**
 * Вызывать при успешном переподключении — сбрасывает cooldown offline,
 * чтобы следующее падение снова сгенерировало уведомление.
 */
export function resetServerOfflineCooldown(serverId: string): void {
  cooldownStates.delete(`server_offline:${serverId}`);
}

// ─── SSL ──────────────────────────────────────────────

export async function notifySslExpiring(opts: {
  serverId: string;
  serverName: string;
  domain: string;
  daysRemaining: number;
  settings: NotificationSettings;
}): Promise<boolean> {
  const { serverId, serverName, domain, daysRemaining, settings } = opts;
  if (!settings.enabled || !settings.sslExpiring) return false;
  if (daysRemaining <= 0 || daysRemaining > settings.sslDaysThreshold) return false;

  const key = `ssl_expiring:${serverId}:${domain}`;
  return oneShotNotify(
    key,
    `ServerPilot — SSL скоро истекает`,
    `${serverName}: сертификат ${domain} истекает через ${daysRemaining} дн. Откройте Nginx → SSL.`,
    // Повторять не чаще раза в 24ч
    24 * 60 * 60 * 1000,
  );
}

export async function notifySslExpired(opts: {
  serverId: string;
  serverName: string;
  domain: string;
  settings: NotificationSettings;
}): Promise<boolean> {
  const { serverId, serverName, domain, settings } = opts;
  if (!settings.enabled || !settings.sslExpired) return false;

  const key = `ssl_expired:${serverId}:${domain}`;
  return oneShotNotify(
    key,
    `ServerPilot — SSL истёк`,
    `${serverName}: сертификат ${domain} истёк! Немедленно обновите через Nginx → SSL.`,
    24 * 60 * 60 * 1000,
  );
}

// ─── Backup ───────────────────────────────────────────

export async function notifyBackupFailed(opts: {
  serverId: string;
  serverName: string;
  sourcePath: string;
  message: string;
  settings: NotificationSettings;
}): Promise<boolean> {
  const { serverId, serverName, sourcePath, message, settings } = opts;
  if (!settings.enabled || !settings.backupFailed) return false;

  const key = `backup_failed:${serverId}:${sourcePath}`;
  return oneShotNotify(
    key,
    `ServerPilot — ошибка резервного копирования`,
    `${serverName}: backup ${sourcePath} завершился с ошибкой. ${message}`,
    // 10 мин cooldown — не спамить если пользователь повторяет
    10 * 60 * 1000,
  );
}

// ─── Deploy ───────────────────────────────────────────

export async function notifyDeployFailed(opts: {
  serverId: string;
  serverName: string;
  repository: string;
  message: string;
  settings: NotificationSettings;
}): Promise<boolean> {
  const { serverId, serverName, repository, message, settings } = opts;
  if (!settings.enabled || !settings.deployFailed) return false;

  const repoShort = repository.replace(/.*\//, "").replace(/\.git$/, "");
  const key = `deploy_failed:${serverId}:${repository}`;
  return oneShotNotify(
    key,
    `ServerPilot — ошибка деплоя`,
    `${serverName}: деплой ${repoShort} не удался. ${message}`,
    5 * 60 * 1000,
  );
}

export async function notifyDeploySuccess(opts: {
  serverId: string;
  serverName: string;
  repository: string;
  branch: string;
  settings: NotificationSettings;
}): Promise<boolean> {
  const { serverId, serverName, repository, branch, settings } = opts;
  if (!settings.enabled || !settings.deploySuccess) return false;

  const repoShort = repository.replace(/.*\//, "").replace(/\.git$/, "");
  const key = `deploy_success:${serverId}:${repository}:${branch}`;
  return oneShotNotify(
    key,
    `ServerPilot — деплой завершён`,
    `${serverName}: ${repoShort} (${branch}) успешно задеплоен.`,
    2 * 60 * 1000,
  );
}

// ─── Тестовая отправка ────────────────────────────────

/** Отправить тестовое уведомление (только вручную из настроек) */
export async function sendTestNotification(): Promise<void> {
  await dispatch(
    "ServerPilot — тест уведомлений",
    "Уведомления работают корректно. Это тестовое сообщение.",
  );
}
