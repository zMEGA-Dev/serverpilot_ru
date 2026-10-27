/**
 * SSH Queue — глобальная очередь SSH-запросов.
 * 
 * Проблема: libssh2 (через ssh2-rs) не является thread-safe при одновременных
 * вызовах на одну SSH сессию. Tauri выполняет команды в thread pool, и когда
 * Dashboard + Monitoring + Files одновременно дёргают SSH — возникает deadlock.
 * 
 * Решение: все invoke-вызовы к SSH-командам проходят через эту очередь.
 * Одновременно выполняется только ОДИН запрос. Остальные ждут.
 */

type Task<T> = () => Promise<T>;

/** Максимум повторных попыток при сетевых ошибках SSH */
const MAX_RETRIES = 2;
/** Базовая задержка между попытками (мс), растёт линейно: 1500, 3000 */
const RETRY_DELAY_MS = 1500;

class SshQueue {
  private running = false;
  private queue: Array<{ task: Task<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  async enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: task as Task<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.drain();
    });
  }

  private async drain() {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;

    this.running = true;
    let lastError: unknown;
    let resolved = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await next.task();
        next.resolve(result);
        resolved = true;
        break;
      } catch (err) {
        lastError = err;
        const msg = String(err).toLowerCase();
        const retryable =
          msg.includes("connection") ||
          msg.includes("session") ||
          msg.includes("channel") ||
          msg.includes("eof") ||
          msg.includes("timeout");
        // Не повторяем, если ошибка не сетевая или попытки исчерпаны
        if (!retryable || attempt === MAX_RETRIES) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
    this.running = false;
    if (!resolved) {
      next.reject(lastError);
    }
    this.drain();
  }

  /** Очистить очередь (например при отключении от сервера). */
  clear() {
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject(new Error("SSH queue cleared"));
    }
  }

  get queueLength() {
    return this.queue.length;
  }

  get isRunning() {
    return this.running;
  }
}

// Глобальный singleton — один на всё приложение
export const sshQueue = new SshQueue();

/**
 * Обёртка над invoke — все SSH-команды должны вызываться через неё.
 * Автоматически ставит в очередь и выполняет последовательно.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export async function sshInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return sshQueue.enqueue(() => tauriInvoke<T>(command, args));
}
