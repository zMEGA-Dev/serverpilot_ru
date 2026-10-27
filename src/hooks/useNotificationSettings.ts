/**
 * useNotificationSettings — хук для чтения и сохранения
 * настроек Desktop-уведомлений в localStorage.
 *
 * Используется в SettingsPage (форма настроек)
 * и во всех страницах, которые читают текущие настройки
 * перед отправкой уведомления.
 */

import { useState, useCallback } from "react";
import {
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from "../services/notificationsService";

interface UseNotificationSettingsReturn {
  settings: NotificationSettings;
  /** Обновить одно поле и сразу сохранить в localStorage */
  update: <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => void;
  /** Сохранить весь объект настроек */
  save: (s: NotificationSettings) => void;
  /** Перезагрузить настройки из localStorage */
  reload: () => void;
}

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const [settings, setSettings] = useState<NotificationSettings>(
    () => loadNotificationSettings(),
  );

  const update = useCallback(
    <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveNotificationSettings(next);
        return next;
      });
    },
    [],
  );

  const save = useCallback((s: NotificationSettings) => {
    saveNotificationSettings(s);
    setSettings(s);
  }, []);

  const reload = useCallback(() => {
    setSettings(loadNotificationSettings());
  }, []);

  return { settings, update, save, reload };
}
