import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Server, CreateServerRequest, UpdateServerRequest, ServerStatus } from "../types";

interface ServersState {
  servers: Server[];
  selectedServerId: string | null;
  connectionStatus: Record<string, ServerStatus>;
  loading: boolean;
  error: string | null;

  // Actions
  loadServers: () => Promise<void>;
  addServer: (req: CreateServerRequest) => Promise<Server>;
  updateServer: (req: UpdateServerRequest) => Promise<Server>;
  deleteServer: (id: string) => Promise<void>;
  selectServer: (id: string | null) => void;
  setConnectionStatus: (serverId: string, status: ServerStatus) => void;
  connectServer: (serverId: string) => Promise<void>;
  getSelectedServer: () => Server | undefined;
}

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  selectedServerId: null,
  connectionStatus: {},
  loading: false,
  error: null,

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await invoke<Server[]>("get_servers");
      set({ servers, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  addServer: async (req) => {
    const server = await invoke<Server>("add_server", { request: req });
    set((state) => ({ servers: [...state.servers, server] }));
    return server;
  },

  updateServer: async (req) => {
    const updated = await invoke<Server>("update_server", { request: req });
    set((state) => ({
      servers: state.servers.map((s) => (s.id === updated.id ? updated : s)),
    }));
    return updated;
  },

  deleteServer: async (id) => {
    await invoke("delete_server", { id });
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      selectedServerId:
        state.selectedServerId === id ? null : state.selectedServerId,
    }));
  },

  selectServer: (id) => {
    set({ selectedServerId: id });
  },

  setConnectionStatus: (serverId, status) => {
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [serverId]: status },
    }));
  },

  connectServer: async (serverId) => {
    const { setConnectionStatus } = get();
    setConnectionStatus(serverId, "connecting");
    try {
      await invoke("connect_ssh", { serverId });
      setConnectionStatus(serverId, "online");
    } catch {
      setConnectionStatus(serverId, "error");
    }
  },

  getSelectedServer: () => {
    const { servers, selectedServerId } = get();
    return servers.find((s) => s.id === selectedServerId);
  },
}));
