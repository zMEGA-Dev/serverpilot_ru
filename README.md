# ServerPilot RU

> **🧪 Beta Release** — See the [Beta Disclaimer](#beta-disclaimer) before use.

**English** | [Русский](README_RU.md)

A local desktop application for managing Linux and VPS servers from Windows. ServerPilot RU connects over SSH and gives you a unified interface for everything you'd normally do through a terminal, a file manager, and a web panel — without sending your credentials anywhere.

---

## What is ServerPilot RU

ServerPilot RU is a [Tauri](https://tauri.app)-based desktop app (Rust backend + React frontend) that runs entirely on your machine. It stores all server credentials locally, encrypted with AES-256-GCM. There is no cloud account, no telemetry, and no required external service.

The primary audience is developers and sysadmins who manage one or more Linux/VPS servers and want a proper desktop tool rather than browser-based panels or juggling multiple SSH sessions.

---

## Screenshots

> Screenshots will be added before the stable release. The interface uses a dark theme by default.

---

## Main Features

### SSH / PTY / SFTP

- SSH connections with password, key file, or SSH agent (Pageant, ssh-agent) authentication
- Full PTY terminal with multi-tab support — runs nano, vim, htop, and other interactive programs
- SFTP file manager with upload, download, rename, delete, chmod, and inline Monaco editor
- Credentials encrypted locally with AES-256-GCM; never logged or transmitted

### Dashboard

Real-time server metrics: CPU, RAM, disk, network, uptime, load average, kernel version, hostname. Color-coded thresholds (yellow at 75%, red at 90%). History charts for CPU, memory, and disk updated every 10 seconds.

### Monitoring

Dedicated monitoring page with configurable refresh interval (3 / 5 / 10 / 30 seconds). Area charts for CPU + RAM combined, separate disk chart, load average chart. Stores up to 720 data points (roughly one hour at 5-second intervals).

### Logs

Log viewer for common sources: syslog, auth.log, kern.log, nginx access/error, Apache2, MySQL, dmesg, dpkg.log, journald. Live tail mode with 3-second polling. Search with match highlighting. Log line classification by severity (error, warning, info). Download button.

### Processes

Full process list via remote `ps`. Sortable table by PID, user, CPU%, RAM%, state, command. Detail panel. Send SIGTERM or SIGKILL with confirmation. Protected PIDs (0, 1, sshd, init, systemd) — killing sshd requires an extra warning.

### PM2

Detects PM2 automatically. One-click install if not present. List with status, CPU, memory, restart count, uptime. App actions: start, stop, restart, reload, delete. Log viewer with search. Create new apps with name, script, working directory, interpreter, and arguments. Environment variable display with secrets masked.

### Docker

Four tabs: Containers, Images, Volumes, Networks. Container actions: start, stop, restart, pause, unpause, remove. Live log viewer with search and tail mode. Pull and delete images. Delete volumes (with data-loss confirmation). Network inspection. Environment variables displayed with secrets masked. Auto-refresh.

### Git Deploy

Detects existing Git repositories. Shows repo status including uncommitted changes. `git clone` and `git pull` with confirmation before pulling over uncommitted changes. Deployment history (last 50 records in localStorage). Desktop notifications on success and failure. "Open in Files" shortcut.

### Nginx

Detects Nginx installation. Lists all sites from `sites-available` and `conf.d`. Per-site actions: enable, disable, delete config entry (without touching the file), reload Nginx, test config. Inline Monaco editor with backup/restore support.

### SSL / Let's Encrypt

Integrated SSL management inside the Nginx section. Detects Certbot. Shows certificate status, issuer, expiry date, and days remaining. Obtain new certificates with domain and email input. Dry-run test before issuing. Auto-renewal status. Desktop notifications for expiring and expired certificates.

### Security Audit

Runs a server-side security audit via the Rust backend. Results grouped by category with a score gauge (0–100). Filter by status: all / critical / warning / passed / unknown. Animated scan progress. Quick-fix actions where applicable.

### Scripts

Script manager backed by SQLite. CRUD with name, description, command, and `{{variable}}` placeholder support (prompted on run). Risk auto-classification using the same logic as the AI assistant. Per-script run history. Variables are passed to the Rust side and resolved there — the frontend never constructs shell commands by concatenation.

### Backups

Creates tar.gz archives on the server via SSH, then downloads via SFTP. Checks free disk space before creating. Download dialog via Tauri fs plugin. Desktop notification on failure. Filter by server and status. History stored in SQLite.

### Notifications

Desktop notifications (Windows native) for: server offline, high CPU/RAM/disk, SSL expiring/expired, backup failure, deployment failure/success. Configurable thresholds per metric. Anti-spam: CPU/RAM/Disk notify only on the first threshold breach and again only after the value drops back below the threshold.

### AI Assistant (BYO API)

Connects to any OpenAI-compatible API endpoint: OpenAI, Ollama, LM Studio, vLLM, or your own server. Step-by-step diagnostic mode — AI proposes one command at a time, you review the risk level and choose to execute or skip. Security: server data (metrics, logs, command output) is always injected as a separate user message marked `[SERVER DATA]`, never in the system prompt — this prevents prompt injection through log content. The API URL is validated (http/https only); API keys are kept in `sessionStorage` (planned: move to encrypted Tauri plugin-store).

---

## Security Principles

- **Credentials encrypted at rest** — AES-256-GCM with a per-installation key derived via SHA-256
- **No shell injection** — all commands are validated on the Rust side; the frontend cannot construct arbitrary shell strings
- **No logging of secrets** — passwords, keys, and tokens are never written to the log file
- **Prompt injection protection** — server data is isolated from the AI system prompt
- **No mandatory cloud** — the app functions entirely offline; no account or license server required
- **Local-only storage** — `%LOCALAPPDATA%\ServerPilotRU\data.db` + `logs\app.log`; nothing leaves your machine unless you explicitly trigger an AI call

---

## Privacy / Local-first

ServerPilot RU does not collect usage data, does not send analytics, and does not require an account. The only outbound network connections are:

1. SSH connections to your own servers
2. AI API calls — only when you explicitly trigger them, to the endpoint you configure

---

## Requirements

- Windows 10 or Windows 11 (x64)
- WebView2 runtime (included in Windows 11; available as a free download for Windows 10)
- Your servers must be reachable over SSH

---

## Installation

### Pre-built installer (recommended)

Download the latest `.exe` installer from the [Releases](../../releases) page and run it.

> WebView2 is required. It is included in Windows 11. On Windows 10, download the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) from Microsoft if prompted.

No additional dependencies needed.

---

## Testing

Download the installer from [Releases](../../releases), install it, and use the app with your own servers.

If you find a bug or want to suggest a feature — open an [Issue](../../issues).

See [RELEASE_TEST_PLAN.md](RELEASE_TEST_PLAN.md) for a detailed test checklist.

---

## Known Limitations

- **Windows only** for now — macOS and Linux builds are possible with Tauri but not yet configured
- **Large files** (> 2 MB) cannot be opened in the inline editor — download and edit locally
- **PTY terminal** opens a separate SSH connection per tab
- Some **Nginx/SSL features** assume a Debian/Ubuntu server layout
- **KDF** uses SHA-256(MachineGUID + AppID); hardening to PBKDF2/Argon2id is planned for the stable release
- **SSH host-key pinning** is not yet implemented (fingerprint is shown but not stored/verified)

---

## Contributing

The source code is open. Pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for build instructions, project layout, and the PR checklist. Fork the repo, branch from `main`, and keep one feature/fix per PR.

Use [Issues](../../issues) for bug reports and feature requests, and [Discussions](../../discussions) for questions and ideas.

---

## Beta Disclaimer

> **ServerPilot RU is currently a Beta release.** It is intended for testing and evaluation. The app is stable for everyday use, but unexpected issues may still occur. Always keep independent backups of anything important.
>
> The SQLite database, credential storage format, and configuration structures may change between Beta versions without a migration path — export your server list from Settings → General before upgrading.

---

## Support / Feedback

- Open an [Issue](../../issues) on GitHub for bug reports and feature requests
- The project is in active development — feedback at this stage is especially valuable

---

## Support the Project

ServerPilot RU is free and open source under the [MIT License](LICENSE). If it saves you time and you want to support continued development:

| Method | Details |
|---|---|
| 🌍 **CloudTips** (card, international) | [pay.cloudtips.ru/p/62be13c3](https://pay.cloudtips.ru/p/62be13c3) |
| 🌐 **Capitalist** (international e-wallet) | Send to account `U22338724` at [capitalist.net](https://capitalist.net) |

Any amount is appreciated. There is no obligation — the app is and will remain free and open source.

---

## Credits

### Created with the moral and financial support of

| | Project | Description |
|---|---|---|
| **S** | [SerpMax](https://serpmax.ru) | SEO and website auditing platform — technical analysis, monitoring, and search optimization |
| **V** | [Vibes](https://vibes.su) | Links, bio pages, QR codes, and digital marketing tools |
| **Z** | [zmega @ Vibes](https://vibes.su/zmega) | Author's bio page — links, projects, and contacts |

---

*ServerPilot RU · Beta · Local-first SSH desktop tool for Windows*
