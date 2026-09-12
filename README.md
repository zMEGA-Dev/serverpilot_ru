# ServerPilot RU

> 🚧 **Alpha Release** — ServerPilot RU is currently in active testing. Please read the [Alpha Disclaimer](#alpha-disclaimer) before using it on important servers.

**English** | [Русский](README_RU.md)

A local-first Windows desktop application for managing Linux and VPS servers over SSH. ServerPilot RU brings terminal access, SFTP, monitoring, logs, deployment tools, Docker, PM2, Nginx, SSL, security checks, scripts, notifications, and optional AI assistance into one desktop interface.

> **Created with the moral and financial support of [SerpMax](https://serpmax.ru) and [Vibes](https://vibes.su).**

---

## What is ServerPilot RU?

ServerPilot RU is a Windows desktop application built with [Tauri 2](https://tauri.app), Rust, React, TypeScript, and WebView2.

The application is designed around a local-first model:

- server connections are made directly from your computer over SSH;
- server credentials are stored locally;
- SSH passwords and key passphrases are encrypted locally with AES-256-GCM;
- there is no required ServerPilot cloud account;
- there is no mandatory telemetry or analytics service;
- AI is optional and uses an endpoint configured by the user.

ServerPilot RU is aimed at developers and system administrators who manage Linux/VPS servers and want a dedicated desktop workflow instead of switching between terminal sessions, file managers, and web panels.

---

## Main Features

### SSH / PTY / SFTP

- SSH authentication with password, private-key file, or SSH agent
- Host-key fingerprint handling and keepalive
- Full PTY terminal with multiple tabs
- Interactive programs such as `bash`, `vim`, `nano`, `htop`, and `top`
- SFTP file browser with upload, download, rename, delete, and file editing
- Monaco-based editor for supported text files
- Local encryption of SSH passwords and key passphrases

### Dashboard

- CPU, RAM, disk, network, uptime, load average
- OS, kernel, hostname, IP address, and user information
- Historical CPU, memory, and disk charts

### Monitoring

- Configurable refresh interval
- CPU, RAM, disk, and load charts
- Local history of collected monitoring points

### Logs

- Common Linux log sources including syslog, auth, kernel, Nginx, Apache, MySQL, dmesg, dpkg, and journald
- Search and match highlighting
- Severity classification
- Live tail mode
- Log download

### Processes

- Remote process list
- PID, user, CPU, memory, state, and command
- Sorting and search
- Process details
- SIGTERM / SIGKILL actions with confirmation and protected system PIDs

### PM2

- PM2 detection and installation
- Process status, CPU, memory, restarts, and uptime
- Start, stop, restart, reload, and delete
- Log viewing
- Application launch form
- Environment-variable secret masking

### Docker

- Containers, images, volumes, and networks
- Start, stop, restart, pause, unpause, and remove
- Container logs and live tail
- Image pull and removal
- Network and container details
- Environment-variable secret masking

### Git Deploy

- Git detection
- Clone and pull workflows
- Branch and directory handling
- Repository status and current commit information
- Uncommitted-change warnings
- Local deployment history

### Nginx

- Nginx detection and status
- Configuration test with `nginx -t`
- Site discovery
- Enable / disable / delete configuration entries
- Monaco configuration editor
- Configuration backups before changes
- Validation before reload

### SSL / Let's Encrypt

- Certbot detection
- Certificate status, issuer, expiry, and remaining days
- Certificate issuance workflow
- Nginx validation before reload
- Renewal status and dry-run support
- Private-key output filtering

### Security Audit

A read-only server audit that checks areas such as:

- SSH configuration
- firewall status
- listening ports
- recent failed logins
- available security tooling

The audit reports **pass / warning / critical / unknown** results and does not change server configuration.

### Saved Scripts

- SQLite-backed script manager
- Variables such as `{{name}}`
- Automatic risk classification
- Confirmation for risky commands
- Execution history
- Command retrieval from the local database
- Rust-side validation and output limits

### Backups

- Creates remote `tar.gz` archives
- Checks source and available disk space
- Downloads the archive through SFTP
- Keeps local backup history

> **Alpha note:** Backup Manager is still part of the Alpha test scope and should not be treated as a replacement for an independent production backup strategy.

### Notifications

Windows desktop notifications for supported events such as:

- server offline
- high CPU / RAM / disk usage
- SSL expiration conditions
- deployment success or failure
- backup failures

Notification thresholds and anti-spam behavior are configurable.

> In the current Alpha, notification monitoring depends on the running application; there is no separate background daemon.

### AI Assistant (BYO API)

Optional AI assistance using OpenAI-compatible endpoints, including services such as OpenAI, Ollama, LM Studio, vLLM, or a user-owned server.

The assistant can:

- collect selected server context;
- propose diagnostic commands step by step;
- classify command risk;
- wait for explicit user approval before execution.

Server data is isolated from the AI system prompt to reduce prompt-injection risk.

AI is optional and is not required for the core server-management features.

---

## Security Principles

- **Local-first:** the core application does not require a ServerPilot cloud service.
- **Encrypted credentials:** SSH passwords and key passphrases are encrypted locally with AES-256-GCM.
- **Explicit command execution:** risky operations require user confirmation.
- **Read-only security audit:** the audit does not modify server configuration.
- **Secret filtering:** sensitive values are filtered from relevant logs and command output.
- **AI isolation:** server-provided data is kept separate from the AI system prompt.
- **No hardcoded API keys:** AI credentials are supplied by the user.

> Security claims in this document describe the current Alpha implementation. They are not a guarantee that the application is impossible to compromise.

---

## Privacy / Network Behavior

ServerPilot RU does not require an account and does not use mandatory analytics.

During normal use, the application may connect to:

1. Linux/VPS servers explicitly configured by the user, primarily over SSH/SFTP.
2. An AI endpoint explicitly configured by the user, when the user invokes AI functionality.
3. External links that the user chooses to open from the application.

SSH authentication credentials are used to authenticate to the user's selected server. They are not sent to a ServerPilot cloud service.

---

## Requirements

- Windows 10 or Windows 11 (x64)
- WebView2
- A Linux/VPS server reachable over SSH

---

## Installation

Download the latest Alpha installer from [GitHub Releases](https://github.com/zMEGA-Dev/serverpilot_ru/releases) and run it.

For Windows 10, install Microsoft [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if it is not already available.

---

## Testing

ServerPilot RU is currently an Alpha release and needs real-world testing with Linux/VPS servers.

Please report bugs and suggestions through [GitHub Issues](https://github.com/zMEGA-Dev/serverpilot_ru/issues).

The project includes a detailed manual checklist in `RELEASE_TEST_PLAN.md` for local testing.

---

## Alpha Disclaimer

> **ServerPilot RU is currently an Alpha release.** The application is provided for testing and evaluation. Features may change, data formats may change between Alpha releases, and unexpected bugs may occur.
>
> Do not rely on the Alpha version as your only means of access or backup for critical production infrastructure. Keep independent backups and an alternative SSH access method.

---

## Known Limitations

- Windows desktop release only
- Dark theme is currently the primary theme
- Text files larger than the editor limit must be downloaded and edited separately
- Each PTY tab uses a separate SSH session
- Some Nginx and SSL workflows assume common Debian/Ubuntu layouts
- Notification checks require the application to be running
- Some long-running remote SSH operations still need additional runtime testing

---

## Feedback

Use [GitHub Issues](https://github.com/zMEGA-Dev/serverpilot_ru/issues) for:

- bug reports
- reproducible problems
- feature suggestions
- Alpha feedback

When reporting a bug, avoid publishing passwords, SSH private keys, API keys, tokens, or other sensitive server data.

---

## Credits

### Created with the moral and financial support of

| Project | |
|---|---|
| **SerpMax** | [serpmax.ru](https://serpmax.ru) — SEO and website auditing platform |
| **Vibes** | [vibes.su](https://vibes.su) — links, bio pages, QR codes, and digital marketing tools |
| **zmega @ Vibes** | [vibes.su/zmega](https://vibes.su/zmega) — author's bio page |

---

## License

No open-source license is currently declared for this Alpha release. Copyright and redistribution permissions should not be assumed beyond the rights granted by applicable law.

---

*ServerPilot RU · Alpha · Local-first SSH desktop tool for Windows*
