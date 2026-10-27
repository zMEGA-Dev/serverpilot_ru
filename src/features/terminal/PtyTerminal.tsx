/**
 * PtyTerminal — интерактивный SSH PTY терминал на базе xterm.js.
 * 
 * Архитектура:
 *  - Открывает ОТДЕЛЬНОЕ SSH соединение (не из SSH_POOL)
 *  - Polling 50ms: pty_read → decode base64 → write to xterm
 *  - Input: xterm.onData → encode base64 → pty_write
 *  - Resize: ResizeObserver → xterm.fit → pty_resize
 */
import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import styles from "./PtyTerminal.module.css";

interface PtyTerminalProps {
  serverId: string;
  tabKey: string; // меняется → пересоздаём сессию
  onTitleChange?: (title: string) => void;
}

// Тёмная тема в стиле приложения
const THEME = {
  background:    "#0d1117",
  foreground:    "#c9d1d9",
  cursor:        "#58a6ff",
  cursorAccent:  "#0d1117",
  selectionBackground: "#264f7888",
  black:         "#484f58",
  red:           "#f85149",
  green:         "#3fb950",
  yellow:        "#d29922",
  blue:          "#58a6ff",
  magenta:       "#bc8cff",
  cyan:          "#39c5cf",
  white:         "#b1bac4",
  brightBlack:   "#6e7681",
  brightRed:     "#f85149",
  brightGreen:   "#56d364",
  brightYellow:  "#e3b341",
  brightBlue:    "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan:    "#56d4dd",
  brightWhite:   "#f0f6fc",
};

export function PtyTerminal({ serverId, tabKey, onTitleChange }: PtyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);
  const sessionRef   = useRef<string | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef   = useRef(true);
  // Disposable-подписки xterm — чтобы не дублировать ввод при переподключении
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const onResizeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const onTitleDisposableRef = useRef<{ dispose: () => void } | null>(null);
  // Флаг «подключено» — предотвращает двойную подписку onData
  const dataSubscribedRef = useRef(false);

  const [connState, setConnState] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errMsg, setErrMsg] = useState("");

  // ─── Создать xterm.js инстанс ──────────────────────
  const createTerm = useCallback(() => {
    if (!containerRef.current) return null;

    termRef.current?.dispose();

    const term = new Terminal({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      allowProposedApi: true,
      convertEol: false, // PTY сам управляет переносами
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
    });

    const fit  = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);

    // Небольшая задержка перед fit — ждём рендера DOM
    setTimeout(() => { try { fit.fit(); } catch {} }, 50);

    termRef.current = term;
    fitRef.current  = fit;
    return { term, fit };
  }, []);

  // ─── Polling вывода от сервера ─────────────────────
  const startPolling = useCallback((sessionId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await invoke<{ data: string; alive: boolean }>("pty_read", {
          sessionId,
        });

        if (res.data && termRef.current) {
          // base64 → Uint8Array → xterm
          const binary = atob(res.data);
          const bytes  = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          termRef.current.write(bytes);
        }

        if (!res.alive && mountedRef.current) {
          termRef.current?.write("\r\n\x1b[90m[Сеанс завершён]\x1b[0m\r\n");
          setConnState("disconnected");
          stopPolling();
        }
      } catch {
        // тихо — временные ошибки чтения нормальны
      }
    }, 50); // 50ms polling — достаточно для интерактивности
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ─── Открыть PTY сессию ────────────────────────────
  const openSession = useCallback(async (term: Terminal, fit: FitAddon) => {
    setConnState("connecting");
    setErrMsg("");

    // Сбрасываем предыдущие подписки, чтобы не дублировать ввод при переподключении
    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = null;
    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = null;
    onTitleDisposableRef.current?.dispose();
    onTitleDisposableRef.current = null;
    dataSubscribedRef.current = false;

    const { rows, cols } = term;

    try {
      const sessionId = await invoke<string>("pty_open", {
        serverId,
        rows,
        cols,
      });

      if (!mountedRef.current) {
        invoke("pty_close", { sessionId }).catch(() => {});
        return;
      }

      sessionRef.current = sessionId;
      setConnState("connected");

      // Ввод пользователя → base64 → PTY
      onDataDisposableRef.current = term.onData((data: string) => {
        if (!sessionRef.current || !dataSubscribedRef.current) return;
        // Кодируем каждый символ/escape sequence в base64
        const bytes = new TextEncoder().encode(data);
        let binary = "";
        bytes.forEach((b) => (binary += String.fromCharCode(b)));
        const b64 = btoa(binary);
        invoke("pty_write", { sessionId: sessionRef.current, data: b64 }).catch(() => {});
      });

      // Resize
      onResizeDisposableRef.current = term.onResize(({ rows: r, cols: c }: { rows: number; cols: number }) => {
        if (!sessionRef.current) return;
        invoke("pty_resize", { sessionId: sessionRef.current, rows: r, cols: c }).catch(() => {});
      });

      // Заголовок из OSC escape sequences
      onTitleDisposableRef.current = term.onTitleChange((title: string) => {
        onTitleChange?.(title);
      });

      dataSubscribedRef.current = true;
      startPolling(sessionId);
    } catch (err) {
      if (!mountedRef.current) return;
      setConnState("error");
      setErrMsg(String(err));
      term.write(`\r\n\x1b[31m✗ Ошибка подключения PTY:\r\n${err}\x1b[0m\r\n`);
    }
  }, [serverId, onTitleChange, startPolling]);

  // ─── Переподключиться ─────────────────────────────
  const reconnect = useCallback(async () => {
    stopPolling();
    if (sessionRef.current) {
      await invoke("pty_close", { sessionId: sessionRef.current }).catch(() => {});
      sessionRef.current = null;
    }
    const term = termRef.current;
    const fit  = fitRef.current;
    if (term && fit) {
      term.clear();
      term.write("\x1b[90mПереподключение...\x1b[0m\r\n");
      openSession(term, fit);
    }
  }, [stopPolling, openSession]);

  // ─── Инициализация при монтировании / смене табки ─
  useEffect(() => {
    mountedRef.current = true;
    const result = createTerm();
    if (!result) return;

    const { term, fit } = result;
    term.write("\x1b[90mПодключение...\x1b[0m\r\n");
    openSession(term, fit);

    return () => {
      mountedRef.current = false;
      stopPolling();
      onDataDisposableRef.current?.dispose();
      onDataDisposableRef.current = null;
      onResizeDisposableRef.current?.dispose();
      onResizeDisposableRef.current = null;
      onTitleDisposableRef.current?.dispose();
      onTitleDisposableRef.current = null;
      dataSubscribedRef.current = false;
      if (sessionRef.current) {
        invoke("pty_close", { sessionId: sessionRef.current }).catch(() => {});
        sessionRef.current = null;
      }
      term.dispose();
      termRef.current = null;
    };
  }, [tabKey]);

  // ─── ResizeObserver ────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch {}
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className={styles.wrapper}>
      {connState !== "connected" && (
        <div className={`${styles.bar} ${connState === "error" ? styles.barError : styles.barInfo}`}>
          {connState === "connecting" && (
            <><span className="spinner" style={{ width: 12, height: 12 }} /> Подключение PTY...</>
          )}
          {connState === "disconnected" && (
            <>Сеанс завершён &nbsp;·&nbsp;
              <button className={styles.reconnBtn} onClick={reconnect}>Переподключиться</button>
            </>
          )}
          {connState === "error" && (
            <>{errMsg || "Ошибка"} &nbsp;·&nbsp;
              <button className={styles.reconnBtn} onClick={reconnect}>Повторить</button>
            </>
          )}
        </div>
      )}
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
}
