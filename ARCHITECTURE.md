# Архитектура ServerPilot RU

## Обзор

ServerPilot RU — Windows desktop-приложение на базе **Tauri 2**, Rust, React, TypeScript и WebView2.

```text
┌────────────────────────────────────────────────────────┐
│                    Windows Desktop App                 │
│                                                        │
│  ┌──────────────────────┐   ┌────────────────────────┐ │
│  │ React / TypeScript   │◄─►│ Rust / Tauri backend   │ │
│  │ WebView2             │   │                        │ │
│  │ i18n ru/en           │   │ SSH / SFTP / PTY       │ │
│  │ UI + feature logic   │   │ SQLite / crypto        │ │
│  │ Monaco Editor        │   │ Tauri IPC              │ │
│  └──────────────────────┘   └─────────────┬──────────┘ │
│                                           │            │
└───────────────────────────────────────────┼────────────┘
                                            │ SSH / SFTP
                                            ▼
                                   ┌──────────────────┐
                                   │ Linux / VPS      │
                                   └──────────────────┘
```

Core server-management operations are performed from the user's Windows machine over SSH/SFTP. ServerPilot RU does not require a ServerPilot cloud backend for the Alpha release.

---

## Frontend ↔ Rust backend

Frontend and native functionality communicate through Tauri IPC (`invoke()`).

Typical flow:

```text
React / TypeScript
        │
        │ Tauri invoke()
        ▼
Rust command handler
        │
        ├── validation
        ├── local state / SQLite
        └── SSH / SFTP / PTY operation
                 │
                 ▼
             Linux / VPS
```

Commands are validated on the Rust side for the operations where server paths, process identifiers, Docker identifiers, configuration content, or other sensitive parameters are involved.

---

## Local data storage

The application stores local state under:

```text
%LOCALAPPDATA%\ServerPilotRU\
```

The SQLite database contains application data such as:

| Area | Purpose |
|---|---|
| `servers` | Server metadata |
| `server_credentials` | Encrypted SSH passwords and key passphrases |
| `command_history` | Local command history |
| `scripts` | Saved scripts |
| `ai_providers` | AI provider configuration |
| `ai_conversations` | Local AI conversation history |
| `audit_log` | Local action history |
| `settings` | Application settings |

The exact schema may change during Alpha development.

---

## Credential protection

SSH passwords and SSH key passphrases stored by the application are encrypted locally using AES-256-GCM with a machine-specific key derivation scheme.

The current implementation is tied to the local Windows installation/machine identity. The private SSH key itself is not copied into the application's database; the application stores the path to the user's key file.

AI credentials are kept separately from the encrypted SSH credential store and should be treated as sensitive local configuration.

---

## SSH sessions

SSH connections are managed through the Rust backend.

The application maintains connection state for normal SSH/SFTP operations and uses separate PTY sessions for interactive terminal tabs.

Typical lifecycle:

```text
connect
  ↓
authenticate
  ↓
validate host key / fingerprint
  ↓
use SSH / SFTP operations
  ↓
keepalive / reconnect when supported
  ↓
disconnect
```

Multiple PTY tabs use separate SSH sessions.

---

## SSH operation serialization

Regular SSH operations use the application's SSH queue/session management to avoid unsafe concurrent access to shared session state.

SFTP obtains an SFTP session through the Rust backend and does not intentionally hold the shared lock for the entire file transfer.

Long-running SSH operations may still require runtime timeout/cancellation improvements in future releases.

---

## AI integration

AI is optional and is configured by the user.

The Alpha supports OpenAI-compatible endpoints such as:

- OpenAI
- Ollama
- LM Studio
- vLLM
- user-owned compatible servers

The high-level flow is:

```text
User
 ↓
AI mode
 ↓
Collect selected server context through Tauri IPC
 ↓
POST to user-configured AI endpoint
 ↓
AI response
 ↓
Risk classification
 ↓
Show proposed command
 ↓
User explicitly approves or skips
 ↓
Rust executes the approved command over SSH
```

Server data is treated as untrusted input and is kept separate from the AI system prompt to reduce prompt-injection risk.

SSH passwords, private keys, and key passphrases are not intentionally included in AI context.

---

## Security boundaries

```text
Windows client
   │
   ├── Local encrypted credentials
   ├── Local SQLite
   ├── Local application logs
   │
   ├── SSH / SFTP ───────────────► User-selected Linux/VPS
   │
   └── Optional AI API ──────────► User-selected AI endpoint
```

There is no mandatory ServerPilot cloud service in the Alpha architecture.

---

## Frontend state

Application state is split into feature-specific stores and local component state as needed.

Typical areas include:

- server list and selected server;
- connection status;
- terminal sessions;
- UI state and command palette;
- monitoring history;
- settings and notification preferences.

The exact internal state structure may evolve during Alpha.

---

## Major modules

```text
src/
├── pages/
│   ├── servers/
│   ├── terminal/
│   ├── files/
│   ├── monitoring/
│   ├── logs/
│   ├── processes/
│   ├── pm2/
│   ├── docker/
│   ├── deployment/
│   ├── nginx/
│   ├── ssl/
│   ├── security/
│   ├── scripts/
│   ├── backups/
│   ├── settings/
│   └── about/
└── ...
```

The project is feature-oriented, but file layout may change during active development.

---

## Future commercial architecture

The Alpha release does **not** require a license server or paid subscription.

For a future commercial release, licensing should be implemented as a separate server-side system. The client should contain only a public verification key, while private signing keys and subscription/payment secrets remain on the server.

```text
ServerPilot Client
        │
        ├── signed license/update data
        ▼
License / Update API
        │
        └── server-side private keys
```

The private signing key must never be embedded in the client application or public repository.
