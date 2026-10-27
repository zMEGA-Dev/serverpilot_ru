import { create } from "zustand";
import type { AppNotification, NotificationType } from "../types";

interface UiState {
  sidebarCollapsed: boolean;
  notifications: AppNotification[];
  commandPaletteOpen: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  addNotification: (type: NotificationType, title: string, message: string, serverId?: string) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

let notifId = 0;

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  notifications: [],
  commandPaletteOpen: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  addNotification: (type, title, message, serverId) => {
    const notif: AppNotification = {
      id: String(++notifId),
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      server_id: serverId,
    };
    set((state) => ({
      notifications: [notif, ...state.notifications].slice(0, 50),
    }));
  },

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clearNotifications: () => set({ notifications: [] }),

  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
}));
