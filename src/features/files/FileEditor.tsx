import React, { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { sshInvoke } from "../../services/sshQueue";
import MonacoEditor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";
import {
  ArrowLeft, Save, AlertTriangle, FileCode,
  Check, X,
} from "lucide-react";
import type { OpenedFile } from "../../types";
import styles from "./FileEditor.module.css";


// ─── Определение языка по расширению ────────────────

const EXT_LANG: Record<string, string> = {
  // Веб
  js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  mjs: "javascript", cjs: "javascript",
  html: "html", htm: "html", xhtml: "html",
  css: "css", scss: "scss", sass: "scss", less: "less",
  // Бэкенд
  php: "php",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp",
  cs: "csharp",
  // Данные
  json: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  xml: "xml",
  sql: "sql",
  // Конфиги / скрипты
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  conf: "nginx", nginx: "nginx",
  htaccess: "apacheconf",
  dockerfile: "dockerfile",
  // Разметка
  md: "markdown", markdown: "markdown",
  // Прочее
  txt: "plaintext",
  log: "plaintext",
  ini: "ini",
  env: "ini",
};

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  // Специальные имена без расширения
  if (lower === "dockerfile") return "dockerfile";
  if (lower === ".htaccess") return "apacheconf";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";
  const ext = lower.split(".").pop() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

// ─── Метка языка для UI ─────────────────────────────

const LANG_LABELS: Record<string, string> = {
  javascript: "JavaScript", typescript: "TypeScript",
  html: "HTML", css: "CSS", scss: "SCSS",
  php: "PHP", python: "Python", ruby: "Ruby",
  go: "Go", rust: "Rust", java: "Java",
  c: "C", cpp: "C++", csharp: "C#",
  json: "JSON", yaml: "YAML", toml: "TOML",
  xml: "XML", sql: "SQL",
  shell: "Shell", nginx: "Nginx", apacheconf: "Apache",
  dockerfile: "Dockerfile", markdown: "Markdown",
  ini: "INI", plaintext: "Текст",
};

function langLabel(lang: string): string {
  return LANG_LABELS[lang] ?? lang;
}

// ─── Пропсы ─────────────────────────────────────────

interface FileEditorProps {
  serverId: string;
  file: OpenedFile;
  onClose: () => void;
  onSaved: () => void;
  onChange: (content: string) => void;
}

// ─── Компонент ──────────────────────────────────────

export function FileEditor({ serverId, file, onClose, onSaved, onChange }: FileEditorProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [wordWrap, setWordWrap] = useState<"on" | "off">("off");
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);

  const language = detectLanguage(file.entry.name);
  const isDirty = file.isDirty;

  // ─ Инициализация Monaco ────────────────────────────
  const handleEditorMount = useCallback((editor: MonacoNS.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;

    // Тёмная тема в стиле приложения
    monaco.editor.defineTheme("serverpilot-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "b3bcc7", background: "0d1117" },
        { token: "comment", foreground: "6e7681", fontStyle: "italic" },
        { token: "string", foreground: "79c0ff" },
        { token: "keyword", foreground: "ff7b72", fontStyle: "bold" },
        { token: "number", foreground: "79c0ff" },
        { token: "type", foreground: "ffa657" },
        { token: "function", foreground: "d2a8ff" },
        { token: "variable", foreground: "b3bcc7" },
        { token: "delimiter", foreground: "8b949e" },
        { token: "tag", foreground: "7ee787" },
        { token: "attribute.name", foreground: "79c0ff" },
        { token: "attribute.value", foreground: "a5d6ff" },
      ],
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#b3bcc7",
        "editor.lineHighlightBackground": "#1c2128",
        "editor.selectionBackground": "#264f78",
        "editorLineNumber.foreground": "#3d4450",
        "editorLineNumber.activeForeground": "#8b949e",
        "editorCursor.foreground": "#3fb950",
        "editorWidget.background": "#161b22",
        "editorWidget.border": "#30363d",
        "editor.wordHighlightBackground": "#1f3b5a",
        "editorIndentGuide.background1": "#1c2128",
        "editorIndentGuide.activeBackground1": "#30363d",
        "scrollbarSlider.background": "#30363d80",
        "scrollbarSlider.hoverBackground": "#30363dcc",
        "minimap.background": "#0d1117",
      },
    });
    monaco.editor.setTheme("serverpilot-dark");

    // Ctrl+S — сохранить
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSave(),
    );

    // Фокус на редактор
    editor.focus();
  }, []);

  // ─ Сохранение ─────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await sshInvoke("sftp_write_file", {
        serverId,
        path: file.entry.path,
        content: file.content,
      });
      onSaved();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [serverId, file.entry.path, file.content, onSaved, saving]);

  // ─ Закрытие с несохранёнными изменениями ──────────
  const handleClose = () => {
    if (isDirty) {
      setConfirmClose(true);
    } else {
      onClose();
    }
  };

  // ─ Горячие клавиши ────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className={styles.editor} onKeyDown={handleKeyDown}>
      {/* Шапка редактора */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={handleClose} title="Назад к файлам">
          <ArrowLeft size={15} />
        </button>

        <div className={styles.fileInfo}>
          <FileCode size={14} className={styles.fileIcon} />
          <span className={styles.fileName}>{file.entry.name}</span>
          {isDirty && <span className={styles.dirtyDot} title="Несохранённые изменения" />}
        </div>

        <span className={styles.filePath}>{file.entry.path}</span>

        <div className={styles.headerRight}>
          {/* Размер шрифта */}
          <div className={styles.fontSizeCtrl}>
            <button className={styles.fontBtn} onClick={() => setFontSize((v) => Math.max(9, v - 1))}>−</button>
            <span className={styles.fontVal}>{fontSize}px</span>
            <button className={styles.fontBtn} onClick={() => setFontSize((v) => Math.min(22, v + 1))}>+</button>
          </div>

          {/* Word wrap */}
          <button
            className={`${styles.wrapBtn} ${wordWrap === "on" ? styles.wrapActive : ""}`}
            onClick={() => setWordWrap((v) => (v === "on" ? "off" : "on"))}
            title="Перенос строк"
          >
            Перенос
          </button>

          {/* Язык */}
          <span className={styles.langBadge}>{langLabel(language)}</span>

          {/* Сохранить */}
          <button
            className={`${styles.saveBtn} ${isDirty ? styles.saveBtnDirty : ""}`}
            onClick={handleSave}
            disabled={saving || !isDirty}
            title="Сохранить (Ctrl+S)"
          >
            {saving ? (
              <span className="spinner" style={{ width: 13, height: 13 }} />
            ) : (
              <Save size={14} />
            )}
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>

      {/* Ошибка сохранения */}
      {saveError && (
        <div className={styles.saveError}>
          <AlertTriangle size={13} />
          <span>{saveError}</span>
          <button className={styles.errClose} onClick={() => setSaveError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Индикатор изменений */}
      {isDirty && (
        <div className={styles.dirtyBanner}>
          <span>Есть несохранённые изменения</span>
          <button className={styles.dirtyBtn} onClick={handleSave} disabled={saving}>
            <Check size={12} /> Сохранить
          </button>
          <span className={styles.dirtySep}>·</span>
          <span className={styles.dirtyHint}>Ctrl+S</span>
        </div>
      )}

      {/* Monaco Editor */}
      <div className={styles.monacoWrap}>
          <MonacoEditor
            height="100%"
            language={language}
            value={file.content}
            onChange={(val) => onChange(val ?? "")}
            onMount={handleEditorMount as OnMount}
            options={{
              fontSize,
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
              fontLigatures: true,
              lineNumbers: "on",
              minimap: { enabled: file.content.length < 50000 },
              wordWrap,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              renderWhitespace: "boundary",
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              smoothScrolling: true,
              cursorBlinking: "phase",
              cursorSmoothCaretAnimation: "on",
              padding: { top: 10, bottom: 10 },
              folding: true,
              suggest: { showKeywords: true },
              quickSuggestions: { other: true, comments: false, strings: false },
              scrollbar: {
                vertical: "auto",
                horizontal: "auto",
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
              // Отключаем тяжёлые фичи для больших файлов
              ...(file.content.length > 100000 ? {
                minimap: { enabled: false },
                folding: false,
                quickSuggestions: false,
                suggest: { showKeywords: false },
                renderWhitespace: "none",
              } : {}),
            }}
            loading={
              <div className={styles.monacoLoading}>
                <span className="spinner" /> Загрузка редактора...
              </div>
            }
          />
      </div>

      {/* Строка состояния внизу */}
      <div className={styles.statusBar}>
        <span>{file.entry.permissions} · {file.entry.owner}:{file.entry.group}</span>
        <span>
          {file.content.split("\n").length} строк ·{" "}
          {new Blob([file.content]).size} байт
        </span>
        <span>{langLabel(language)}</span>
        <span>UTF-8</span>
      </div>

      {/* Диалог подтверждения закрытия */}
      {confirmClose && (
        <div className={styles.confirmOverlay} onClick={() => setConfirmClose(false)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmTitle}>
              <AlertTriangle size={16} style={{ color: "var(--accent-yellow)" }} />
              Несохранённые изменения
            </div>
            <p className={styles.confirmMsg}>
              Файл «{file.entry.name}» содержит несохранённые изменения.
              Закрыть без сохранения?
            </p>
            <div className={styles.confirmActions}>
              <button className={styles.btnSecondary} onClick={() => setConfirmClose(false)}>
                Отмена
              </button>
              <button
                className={styles.btnSaveAndClose}
                onClick={async () => {
                  setConfirmClose(false);
                  await handleSave();
                  onClose();
                }}
              >
                <Save size={13} /> Сохранить и закрыть
              </button>
              <button className={styles.btnCloseAnyway} onClick={() => { setConfirmClose(false); onClose(); }}>
                Закрыть без сохранения
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
