import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  DragEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { sshInvoke } from "../services/sshQueue";
import {
  FolderOpen, File, FolderPlus, FilePlus, RefreshCw,
  ArrowUp, Home, Trash2, Edit2, Download, Upload,
  ChevronRight, AlertTriangle, X, Check, Copy,
  FileText, FileCode, Archive, Image, Terminal,
} from "lucide-react";
import { useServersStore } from "../stores/serversStore";
import type { FileEntry, FileContent, OpenedFile } from "../types";
import { FileEditor } from "../features/files/FileEditor";
import styles from "./FilesPage.module.css";

// ─── Утилиты ───────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 Б";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} МБ`;
  return `${(bytes / 1073741824).toFixed(2)} ГБ`;
}

function getFileIcon(entry: FileEntry): React.ReactNode {
  if (entry.is_dir) return <FolderOpen size={15} style={{ color: "var(--accent-yellow)" }} />;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "ts", "jsx", "tsx", "php", "py", "rb", "go", "rs", "java", "c", "cpp", "h"].includes(ext))
    return <FileCode size={15} style={{ color: "var(--accent-blue)" }} />;
  if (["sh", "bash", "zsh", "fish"].includes(ext))
    return <Terminal size={15} style={{ color: "var(--accent-green)" }} />;
  if (["zip", "tar", "gz", "bz2", "xz", "7z"].includes(ext))
    return <Archive size={15} style={{ color: "var(--accent-orange)" }} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext))
    return <Image size={15} style={{ color: "var(--accent-purple)" }} />;
  if (["txt", "md", "log", "conf", "cfg", "ini", "env"].includes(ext))
    return <FileText size={15} style={{ color: "var(--text-muted)" }} />;
  return <File size={15} style={{ color: "var(--text-muted)" }} />;
}

function isEditable(entry: FileEntry): boolean {
  if (entry.is_dir) return false;

  // Файлы > 2 МБ не открываем в редакторе
  if (entry.size > 2 * 1024 * 1024) return false;

  const name = entry.name.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : "";

  // Файлы без расширения — открываем по имени
  const editableNames = [
    "dockerfile", "makefile", "gnumakefile", "rakefile", "gemfile",
    "vagrantfile", ".htaccess", ".env", ".gitignore", ".gitattributes",
    ".editorconfig", ".babelrc", ".eslintrc", ".prettierrc",
    "nginx.conf", "supervisord.conf", "redis.conf",
  ];
  if (editableNames.includes(name)) return true;

  // Файл без расширения — скорее всего текстовый (скрипт, конфиг)
  if (!ext && entry.size < 512 * 1024) return true;

  // Расширения
  const editableExts = new Set([
    // Веб
    "js", "jsx", "ts", "tsx", "mjs", "cjs",
    "html", "htm", "xhtml", "xml", "svg",
    "css", "scss", "sass", "less",
    // Бэкенд
    "php", "py", "rb", "go", "rs", "java",
    "c", "h", "cpp", "cc", "cs", "swift",
    // Скрипты
    "sh", "bash", "zsh", "fish", "ps1",
    // Данные/конфиги
    "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env",
    // Текст
    "txt", "md", "markdown", "rst", "csv", "log",
    // БД
    "sql",
    // Спец
    "nginx", "htaccess", "dockerfile",
    "lock", "sum", "mod",
    // Нет расширения — уже выше
  ]);

  return editableExts.has(ext);
}

// ─── Диалоговые компоненты ──────────────────────────

interface InputDialogProps {
  title: string;
  label: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}
function InputDialog({ title, label, defaultValue = "", onConfirm, onCancel }: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>{title}</div>
        <label className={styles.dialogLabel}>{label}</label>
        <input
          ref={inputRef}
          className={styles.dialogInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className={styles.dialogActions}>
          <button className={styles.btnSecondary} onClick={onCancel}>Отмена</button>
          <button className={styles.btnPrimary} onClick={() => value.trim() && onConfirm(value.trim())}>
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  dangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
function ConfirmDialog({ title, message, dangerous, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>
          {dangerous && <AlertTriangle size={16} style={{ color: "var(--accent-red)" }} />}
          {title}
        </div>
        <p className={`${styles.dialogMessage} ${dangerous ? styles.dangerText : ""}`}>
          {message}
        </p>
        <div className={styles.dialogActions}>
          <button className={styles.btnSecondary} onClick={onCancel}>Отмена</button>
          <button
            className={dangerous ? styles.btnDanger : styles.btnPrimary}
            onClick={onConfirm}
          >
            {dangerous ? "Удалить" : "Подтвердить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Контекстное меню ───────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  entry: FileEntry;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCopyPath: () => void;
  onClose: () => void;
}
function ContextMenu({ x, y, entry, onEdit, onRename, onDelete, onDownload, onCopyPath, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  // Подправляем позицию чтобы не выходить за экран
  const adjustedY = Math.min(y, window.innerHeight - 220);
  const adjustedX = Math.min(x, window.innerWidth - 200);

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ top: adjustedY, left: adjustedX }}
    >
      {!entry.is_dir && isEditable(entry) && (
        <button className={styles.ctxItem} onClick={onEdit}>
          <Edit2 size={13} /> Открыть в редакторе
        </button>
      )}
      <button className={styles.ctxItem} onClick={onCopyPath}>
        <Copy size={13} /> Копировать путь
      </button>
      {!entry.is_dir && (
        <button className={styles.ctxItem} onClick={onDownload}>
          <Download size={13} /> Скачать
        </button>
      )}
      <div className={styles.ctxDivider} />
      <button className={styles.ctxItem} onClick={onRename}>
        <Edit2 size={13} /> Переименовать
      </button>
      <div className={styles.ctxDivider} />
      <button className={`${styles.ctxItem} ${styles.ctxDanger}`} onClick={onDelete}>
        <Trash2 size={13} /> Удалить
      </button>
    </div>
  );
}

// ─── Главная страница файлового менеджера ───────────

type Dialog =
  | { type: "new-folder" }
  | { type: "new-file" }
  | { type: "rename"; entry: FileEntry }
  | { type: "delete"; entry: FileEntry }
  | { type: "chmod"; entry: FileEntry };

export function FilesPage() {
  const { selectedServerId, connectionStatus } = useServersStore();
  const status = selectedServerId ? connectionStatus[selectedServerId] : undefined;

  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false); // отдельный state для открытия файла
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref для отмены открытия файла
  const openAbortRef = useRef<boolean>(false);

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 3000);
  };

  // ─ Загрузить список файлов ─────────────────────────
  const loadDir = useCallback(async (path: string) => {
    if (!selectedServerId || status !== "online") return;
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const result = await sshInvoke<FileEntry[]>("sftp_list_dir", {
        serverId: selectedServerId,
        path,
      });
      setEntries(result);
      setCurrentPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedServerId, status]);

  useEffect(() => {
    if (status === "online") {
      // Проверяем если DeploymentPage передал путь для открытия
      const openPath = sessionStorage.getItem("files_open_path");
      if (openPath) {
        sessionStorage.removeItem("files_open_path");
        loadDir(openPath);
      } else {
        loadDir("/");
      }
    } else {
      setEntries([]);
      setCurrentPath("/");
    }
  }, [selectedServerId, status]);

  // ─ Навигация ───────────────────────────────────────
  const navigate = (path: string) => {
    setOpenedFile(null);
    loadDir(path);
  };

  const goUp = () => {
    const parent = currentPath.replace(/\/[^/]+$/, "") || "/";
    navigate(parent);
  };

  // ─ Breadcrumbs ─────────────────────────────────────
  const breadcrumbs = (() => {
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  })();

  // ─ Открыть файл в редакторе ────────────────────────
  const openFile = async (entry: FileEntry) => {
    if (!selectedServerId) return;

    // Жёсткое ограничение по размеру — не ждём ответа сервера
    if (entry.size > 2 * 1024 * 1024) {
      setError(`Файл «${entry.name}» слишком большой (${formatSize(entry.size)}). Максимум для редактора — 2 МБ.`);
      return;
    }

    // Сбрасываем флаг отмены и устанавливаем loading именно для открытия файла
    openAbortRef.current = false;
    setFileLoading(true);
    setError(null);

    // Таймаут 30 секунд — если SFTP не отвечает (например, SSH pool заблокирован другим запросом)
    const TIMEOUT_MS = 30_000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `Превышено время ожидания (${TIMEOUT_MS / 1000}с). Файл не удалось открыть. ` +
        `Возможно, SSH-соединение занято другой операцией. Попробуйте позже.`
      )), TIMEOUT_MS)
    );

    try {
      const result = await Promise.race([
        sshInvoke<FileContent>("sftp_read_file", {
          serverId: selectedServerId,
          path: entry.path,
        }),
        timeoutPromise,
      ]);

      // Если пользователь успел нажать отмену — не открываем редактор
      if (openAbortRef.current) return;

      if (result.is_binary) {
        setError(`Файл «${entry.name}» является бинарным — редактор не поддерживает такие файлы. Используйте скачивание.`);
        return;
      }

      setOpenedFile({
        entry,
        content: result.content,
        originalContent: result.content,
        isDirty: false,
      });
    } catch (err) {
      if (!openAbortRef.current) {
        setError(String(err));
      }
    } finally {
      setFileLoading(false);
    }
  };

  // Отменить открытие файла (пока идёт загрузка)
  const cancelFileOpen = () => {
    openAbortRef.current = true;
    setFileLoading(false);
    setError(null);
  };

  const handleDoubleClick = (entry: FileEntry) => {
    if (entry.is_dir) {
      navigate(entry.path);
    } else if (isEditable(entry)) {
      openFile(entry);
    }
  };

  // ─ Создать папку ───────────────────────────────────
  const handleCreateFolder = async (name: string) => {
    setDialog(null);
    if (!selectedServerId) return;
    const path = `${currentPath.replace(/\/$/, "")}/${name}`;
    try {
      await sshInvoke("sftp_create_dir", { serverId: selectedServerId, path });
      showStatus(`Папка «${name}» создана`);
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  // ─ Создать файл ────────────────────────────────────
  const handleCreateFile = async (name: string) => {
    setDialog(null);
    if (!selectedServerId) return;
    const path = `${currentPath.replace(/\/$/, "")}/${name}`;
    try {
      await sshInvoke("sftp_create_file", { serverId: selectedServerId, path });
      showStatus(`Файл «${name}» создан`);
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  // ─ Переименовать ───────────────────────────────────
  const handleRename = async (newName: string) => {
    const entry = (dialog as { type: "rename"; entry: FileEntry }).entry;
    setDialog(null);
    if (!selectedServerId || !entry) return;
    const dir = entry.path.replace(/\/[^/]+$/, "") || "/";
    const newPath = `${dir}/${newName}`;
    try {
      await sshInvoke("sftp_rename", {
        serverId: selectedServerId,
        oldPath: entry.path,
        newPath,
      });
      showStatus(`Переименовано в «${newName}»`);
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  // ─ Удалить ─────────────────────────────────────────
  const handleDelete = async () => {
    const entry = (dialog as { type: "delete"; entry: FileEntry }).entry;
    setDialog(null);
    if (!selectedServerId || !entry) return;
    try {
      if (entry.is_dir) {
        await sshInvoke("sftp_delete_dir", { serverId: selectedServerId, path: entry.path });
      } else {
        await sshInvoke("sftp_delete_file", { serverId: selectedServerId, path: entry.path });
      }
      showStatus(`«${entry.name}» удалён`);
      if (openedFile?.entry.path === entry.path) setOpenedFile(null);
      loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  // ─ Скачать файл ────────────────────────────────────
  const handleDownload = async (entry: FileEntry) => {
    if (!selectedServerId) return;
    setCtxMenu(null);
    try {
      showStatus("Скачивание...", true);
      const b64 = await sshInvoke<string>("sftp_download_file", {
        serverId: selectedServerId,
        path: entry.path,
      });

      // Декодируем base64 → Uint8Array
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // Сохраняем через tauri dialog
      const savePath = await saveDialog({ defaultPath: entry.name });
      if (savePath) {
        await writeFile(savePath, bytes);
        showStatus(`«${entry.name}» сохранён`);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  // ─ Загрузить файл (кнопка) ─────────────────────────
  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedServerId) return;
    await uploadFiles(Array.from(files));
    e.target.value = "";
  };

  const uploadFiles = async (files: File[]) => {
    if (!selectedServerId) return;
    setUploading(true);
    let ok = 0;
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Конвертируем в base64
        let b64 = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          b64 += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const dataB64 = btoa(b64);
        const remotePath = `${currentPath.replace(/\/$/, "")}/${file.name}`;
        await sshInvoke("sftp_upload_file", {
          serverId: selectedServerId,
          path: remotePath,
          dataB64,
        });
        ok++;
      } catch (err) {
        setError(`Ошибка загрузки «${file.name}»: ${err}`);
      }
    }
    setUploading(false);
    if (ok > 0) {
      showStatus(`Загружено файлов: ${ok}`);
      loadDir(currentPath);
    }
  };

  // ─ Drag & Drop ─────────────────────────────────────
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await uploadFiles(files);
  };

  // ─ Контекстное меню ────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  // ─── Если не подключено ────────────────────────────
  if (status !== "online") {
    return (
      <div className={styles.empty}>
        <FolderOpen size={40} style={{ opacity: 0.3 }} />
        <p>Подключитесь к серверу для управления файлами</p>
      </div>
    );
  }

  // ─── Редактор открыт ──────────────────────────────
  if (openedFile) {
    return (
      <FileEditor
        serverId={selectedServerId!}
        file={openedFile}
        onClose={() => setOpenedFile(null)}
        onSaved={() => {
          setOpenedFile((f) => f ? { ...f, isDirty: false, originalContent: f.content } : null);
          showStatus("Файл сохранён");
        }}
        onChange={(content) =>
          setOpenedFile((f) =>
            f ? { ...f, content, isDirty: content !== f.originalContent } : null
          )
        }
      />
    );
  }

  // ─── Браузер файлов ───────────────────────────────
  return (
    <div
      className={`${styles.page} ${isDragOver ? styles.dragOver : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Overlay загрузки файла — показывается поверх таблицы пока читается файл */}
      {fileLoading && (
        <div className={styles.fileLoadingOverlay}>
          <div className={styles.fileLoadingBox}>
            <span className="spinner" style={{ width: 20, height: 20 }} />
            <span>Открытие файла...</span>
            <button className={styles.fileLoadingCancel} onClick={cancelFileOpen}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {/* Тулбар */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button className={styles.iconBtn} onClick={goUp} disabled={currentPath === "/"} title="Вверх">
            <ArrowUp size={14} />
          </button>
          <button className={styles.iconBtn} onClick={() => navigate("/")} title="Домой">
            <Home size={14} />
          </button>
          <button className={styles.iconBtn} onClick={() => loadDir(currentPath)} disabled={loading} title="Обновить">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className={styles.breadcrumbs}>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              {i > 0 && <ChevronRight size={12} className={styles.breadSep} />}
              <button
                className={`${styles.breadItem} ${i === breadcrumbs.length - 1 ? styles.breadActive : ""}`}
                onClick={() => navigate(crumb.path)}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className={styles.toolbarRight}>
          <button className={styles.toolBtn} onClick={() => setDialog({ type: "new-folder" })}>
            <FolderPlus size={13} /> Папка
          </button>
          <button className={styles.toolBtn} onClick={() => setDialog({ type: "new-file" })}>
            <FilePlus size={13} /> Файл
          </button>
          <button
            className={`${styles.toolBtn} ${styles.uploadBtn}`}
            onClick={handleUploadClick}
            disabled={uploading}
          >
            <Upload size={13} />
            {uploading ? "Загрузка..." : "Загрузить"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileInputChange}
          />
        </div>
      </div>

      {/* Статус */}
      {statusMsg && (
        <div className={`${styles.statusBar} ${statusMsg.ok ? styles.statusOk : styles.statusErr}`}>
          {statusMsg.ok ? <Check size={12} /> : <X size={12} />}
          {statusMsg.text}
        </div>
      )}

      {/* Ошибка */}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={13} />
          <span>{error}</span>
          <button className={styles.errClose} onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Drag-over оверлей */}
      {isDragOver && (
        <div className={styles.dropOverlay}>
          <Upload size={40} />
          <p>Отпустите файлы для загрузки в {currentPath}</p>
        </div>
      )}

      {/* Таблица файлов */}
      <div className={styles.fileTable}>
        <div className={styles.tableHeader}>
          <span className={styles.colIcon} />
          <span className={styles.colName}>Имя</span>
          <span className={styles.colSize}>Размер</span>
          <span className={styles.colDate}>Изменён</span>
          <span className={styles.colPerms}>Права</span>
          <span className={styles.colOwner}>Владелец</span>
        </div>

        <div className={styles.tableBody}>
          {loading && (
            <div className={styles.loadingRow}>
              <span className="spinner" /> Загрузка...
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className={styles.emptyDir}>Директория пуста</div>
          )}

          {!loading && entries.map((entry) => (
            <div
              key={entry.path}
              className={`${styles.fileRow} ${selected?.path === entry.path ? styles.fileRowSelected : ""}`}
              onClick={() => setSelected(entry)}
              onDoubleClick={() => handleDoubleClick(entry)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
            >
              <span className={styles.colIcon}>{getFileIcon(entry)}</span>
              <span className={`${styles.colName} ${entry.is_dir ? styles.dirName : ""}`}>
                {entry.name}
                {entry.is_symlink && <span className={styles.symlinkBadge}>→</span>}
              </span>
              <span className={styles.colSize}>
                {entry.is_dir ? "—" : formatSize(entry.size)}
              </span>
              <span className={styles.colDate}>{entry.modified}</span>
              <span className={styles.colPerms}>{entry.permissions}</span>
              <span className={styles.colOwner}>{entry.owner}:{entry.group}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Строка статуса */}
      <div className={styles.footer}>
        <span>{entries.length} объектов</span>
        {selected && (
          <span className={styles.footerSelected}>
            Выбран: {selected.name}
            {!selected.is_dir && ` · ${formatSize(selected.size)}`}
            · {selected.permissions_octal}
          </span>
        )}
        <span className={styles.footerHint}>
          Двойной клик — открыть · ПКМ — меню · Перетащите файлы для загрузки
        </span>
      </div>

      {/* Контекстное меню */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          entry={ctxMenu.entry}
          onEdit={() => { setCtxMenu(null); openFile(ctxMenu.entry); }}
          onRename={() => { setDialog({ type: "rename", entry: ctxMenu.entry }); setCtxMenu(null); }}
          onDelete={() => { setDialog({ type: "delete", entry: ctxMenu.entry }); setCtxMenu(null); }}
          onDownload={() => handleDownload(ctxMenu.entry)}
          onCopyPath={() => {
            navigator.clipboard.writeText(ctxMenu.entry.path);
            showStatus("Путь скопирован");
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Диалоги */}
      {dialog?.type === "new-folder" && (
        <InputDialog
          title="Создать папку"
          label="Название папки"
          onConfirm={handleCreateFolder}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === "new-file" && (
        <InputDialog
          title="Создать файл"
          label="Название файла"
          onConfirm={handleCreateFile}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === "rename" && (
        <InputDialog
          title="Переименовать"
          label="Новое название"
          defaultValue={dialog.entry.name}
          onConfirm={handleRename}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          title={`Удалить ${dialog.entry.is_dir ? "папку" : "файл"}?`}
          message={
            dialog.entry.is_dir
              ? `Папка «${dialog.entry.name}» будет удалена. Это действие необратимо.\n\nВНИМАНИЕ: папка должна быть пустой.`
              : `Файл «${dialog.entry.name}» будет удалён безвозвратно.`
          }
          dangerous
          onConfirm={handleDelete}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
