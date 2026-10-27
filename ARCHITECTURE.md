# Архитектура ServerPilot RU

## Обзор

ServerPilot RU — нативное desktop-приложение на базе **Tauri 2** (Rust + WebView2).

```
┌─────────────────────────────────────────────────────┐
│                  Windows Desktop App                 │
│                                                     │
│  ┌────────────────────┐   ┌──────────────────────┐  │
│  │   React Frontend   │   │    Rust Backend      │  │
│  │   (WebView2)       │◄──►│    (Tauri)           │  │
│  │                    │   │                      │  │
│  │  React + TS        │   │  SSH (ssh2 crate)    │  │
│  │  Zustand stores    │   │  SQLite (rusqlite)   │  │
│  │  React Router      │   │  AES-256-GCM crypto  │  │
│  │  Recharts          │   │  Tauri IPC commands  │  │
│  │  i18next (ru/en)   │   │                      │  │
│  └────────────────────┘   └──────────────────────┘  │
│                                    │                 │
│                           ┌────────▼───────┐        │
│                           │ Linux/VPS      │        │
│                           │ (SSH directly) │        │
│                           └────────────────┘        │
└─────────────────────────────────────────────────────┘
```

## Взаимодействие Frontend ↔ Backend

Все вызовы идут через **Tauri IPC** (`invoke()`):

```typescript
// Frontend (TypeScript)
const result = await invoke<CommandResult>("execute_command", {
  serverId: "abc-123",
  command: "df -h"
});
```

```rust
// Backend (Rust)
#[tauri::command]
pub fn execute_command(
    state: State<AppState>,
    server_id: String,
    command: String,
) -> Result<CommandResult, String> { ... }
```

## Хранение данных

### SQLite (local, `%LOCALAPPDATA%/ServerPilotRU/data.db`)

| Таблица | Содержимое |
|---|---|
| `servers` | Метаданные серверов (без паролей) |
| `server_credentials` | AES-256-GCM зашифрованные credentials |
| `command_history` | История выполненных команд |
| `scripts` | Сохранённые скрипты |
| `ai_providers` | Конфигурации AI провайдеров |
| `ai_conversations` | История AI-диалогов |
| `audit_log` | Аудит действий: id, server_id, server_name, action, command, result, success, timestamp |
| `settings` | Настройки приложения |

### Безопасность хранения

Пароли и ключевые фразы **никогда** не хранятся в plain text:

```
plaintext password
       ↓
AES-256-GCM encrypt (key = SHA-256(MachineGUID + "-" + AppID))
       ↓
base64(nonce + ciphertext)
       ↓
server_credentials table
```

## SSH Connection Pool

```
AppState {
    db: Mutex<Database>,
}

SSH_POOL: Lazy<Mutex<HashMap<server_id, ManagedSession>>>
```

- Соединения хранятся в глобальном пуле по `server_id`
- Переподключение при разрыве
- При удалении сервера — автоматическое отключение

## AI Integration

AI работает через **OpenAI-compatible REST API** — только с frontend-а:

```
User prompt
    ↓
Collect server context (CPU, RAM, OS, recent logs) via Tauri IPC
    ↓
POST /v1/chat/completions → AI provider (configurable endpoint)
    ↓
Parse response → extract КОМАНДА: + ОБЪЯСНЕНИЕ:
    ↓
Classify risk (read_only / low / medium / high / critical)
    ↓
Show to user with risk warning
    ↓
User clicks "Выполнить"
    ↓
invoke("execute_command") → SSH → result → display
```

**Важно:** приватные ключи и пароли **никогда** не передаются в AI API.

## Frontend State Management

```
serversStore (Zustand)
├── servers[]
├── selectedServerId
├── connectionStatus{}
└── loadServers / addServer / deleteServer / ...

uiStore (Zustand)
├── sidebarCollapsed
├── notifications[]
└── commandPaletteOpen
```

## Модули (Feature-based structure)

```
src/features/
├── servers/      # CRUD серверов, форма добавления
├── terminal/     # SSH терминал, вкладки, history
├── files/        # SFTP файловый менеджер (Этап 4)
├── monitoring/   # CPU/RAM/Disk графики (Этап 5)
├── logs/         # Просмотр логов, live tail (Этап 6)
├── ai/           # AI провайдеры, команды, approval
├── security/     # Audit проверки (Этап 9)
├── scripts/      # Сохранённые скрипты (Этап 9)
├── deployment/   # Git деплой (Этап 8)
└── settings/     # Настройки приложения
```
