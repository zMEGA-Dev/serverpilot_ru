/**
 * XTerminal — полноценный PTY-терминал на основе xterm.js.
 * Поддерживает: ANSI colors, resize, Ctrl+C/D/L/Z, nano, vim, sudo, htop и т.д.
 */
import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import styles from "./XTerminal.module.css";

interface XTerminalProps {
  serverId: string;
  sessionKey: string; // уникальный ключ вкладки — при смене пересоздаём терминал
  onTitle?: (title: string) => void;
}

export function XTerminal({ serverId, sessionKey, onTitle }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");

  // ─── Инициализация xterm.js ──────────────────────

  const initTerminal = useCallback(() => {
    if (!containerRef.current) return;

    // Уничтожаем предыдущий инстанс
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    const term = new Terminal({
      theme: {
        background: "#0d1117",
        foreground: "#b3bcc7",
        cursor: "#3fb950",
        cursorAccent: "#0d1117",
        black: "#0d1117",
        red: "#f85149",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#4f8ef7",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b3bcc7",
        brightBlack: "#6e7681",
        brightRed: "#f85149",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#e6edf3",
        selectionBackground: "#264f7880",
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    return { term, fitAddon };
  }, []);

  // ─── Старт PTY ───────────────────────────────────

  const startPty = useCallback(async (term: Terminal, fitAddon: FitAddon) => {
    setStatus("connecting");
    setErrorMsg("");

    const { rows, cols } = term;

    try {
      const sessionId = await invoke<string>("pty_start", {
        serverId,
        rows,
        cols,
      });

      sessionIdRef.current = sessionId;
      setStatus("connected");

      // Отправляем ввод пользователя → PTY
      term.onData((data) => {
        if (!sessionIdRef.current) return;
        const encoded = btoa(
          Array.from(new TextEncoder().encode(data))
            .map((b) => String.fromCharCode(b))
            .join("")
        );
        invoke("pty_write", { sessionId: sessionIdRef.current, data: encoded }).catch(() => {});
      });

      // Resize при изменении размера терминала
      term.onResize(({ rows: r, cols: c }) => {
        if (!sessionIdRef.current) return;
        invoke("pty_resize", { sessionId: sessionIdRef.current, rows: r, cols: c }).catch(() => {});
      });

      // Заголовок из escape-sequences
      term.onTitleChange((title) => {
        onTitle?.(title);
      });

      // Polling — читаем данные от сервера каждые 50мс
      startPolling();

    } catch (err) {
      setStatus("error");
      setErrorMsg(String(err));
      term.write(`\r\n\x1b[31m✗ Ошибка: ${err}\x1b[0m\r\n`);
    }
  }, [serverId, onTitle]);

  // ─── Polling вывода ──────────────────────────────

  const startPolling = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      const sid = sessionIdRef.current;
      const term = termRef.current;
      if (!sid || !term) return;

      try {
        const result = await invoke<{ data: string; alive: boolean }>("pty_read", {
          sessionId: sid,
        });

        if (result.data) {
          // Декодируем base64 → Uint8Array → строка с ANSI
          const binary = atob(result.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          term.write(text);
        }

        if (!result.alive) {
          term.write("\r\n\x1b[90m[Сессия завершена]\x1b[0m\r\n");
          setStatus("disconnected");
          stopPolling();
        }
      } catch {
        // Тихо — может быть временная ошибка
      }
    }, 50);
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // ─── Resize observer ─────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      fitRef.current?.fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ─── Инициализация при монтировании / смене вкладки ─

  useEffect(() => {
    const result = initTerminal();
    if (!result) return;

    const { term, fitAddon } = result;
    term.write("\x1b[90mПодключение...\x1b[0m\r\n");

    startPty(term, fitAddon);

    return () => {
      stopPolling();
      if (sessionIdRef.current) {
        invoke("pty_close", { sessionId: sessionIdRef.current }).catch(() => {});
        sessionIdRef.current = null;
      }
      term.dispose();
    };
  }, [sessionKey]);

  // ─── Переподключение ─────────────────────────────

  const handleReconnect = async () => {
    stopPolling();
    if (sessionIdRef.current) {
      await invoke("pty_close", { sessionId: sessionIdRef.current }).catch(() => {});
      sessionIdRef.current = null;
    }
    termRef.current?.clear();
    const term = termRef.current;
    const fit = fitRef.current;
    if (term && fit) {
      term.write("\x1b[90mПереподключение...\x1b[0m\r\n");
      await startPty(term, fit);
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* Статус-бар */}
      {status !== "connected" && (
        <div className={`${styles.statusBar} ${status === "error" ? styles.statusError : styles.statusInfo}`}>
          {status === "connecting" && <><span className="spinner" style={{width:12,height:12}}/> Подключение...</>}
          {status === "disconnected" && <>Сессия завершена · <button className={styles.reconnectBtn} onClick={handleReconnect}>Переподключиться</button></>}
          {status === "error" && <>{errorMsg || "Ошибка"} · <button className={styles.reconnectBtn} onClick={handleReconnect}>Повторить</button></>}
        </div>
      )}

      {/* Контейнер xterm.js */}
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
}
