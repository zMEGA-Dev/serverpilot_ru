# Contributing to ServerPilot RU

Thanks for your interest in contributing! This project is a Windows desktop app for managing Linux/VPS servers over SSH, built with **Tauri 2** (Rust backend) and **React + TypeScript** (frontend). The project is primarily Russian-speaking, but contributions in English are welcome.

## Project status

`v1.0.0-beta.1` — see [RELEASE_NOTES.md](./RELEASE_NOTES.md) for what is done and the [Known Limitations](./RELEASE_NOTES.md#known-limitations) section for what is planned (PBKDF2/Argon2id KDF, SSH host-key pinning, AI config in encrypted SQLite).

## Prerequisites

- **Node.js** 20+ and npm
- **Rust** (stable, `x86_64-pc-windows-msvc` target) via [rustup](https://rustup.rs/)
- **Visual Studio Build Tools** (C++ workload) — provides the MSVC linker required by Rust on Windows
- **Windows 10/11 x64** (build target)

## Build & run locally

```powershell
# from the repo root
npm install              # frontend deps
npm run tauri:dev        # run the app in dev mode (hot reload)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run build            # frontend production build
npm run tauri:build      # full release build -> NSIS installer in src-tauri/target/release/bundle/nsis/
```

The first `tauri:dev` / `tauri:build` compiles ~550 Rust crates and takes several minutes; subsequent builds are fast thanks to incremental compilation.

## Project layout

```
src/                 # frontend (React + TypeScript)
  pages/             # one page per feature tab (Dashboard, Terminal, Files, ...)
  features/          # feature-scoped components (terminal, files, nginx)
  components/         # shared UI (layout, error boundary, command palette)
  stores/            # Zustand stores
  services/          # sshQueue, notifications
  i18n/locales/      # ru.ts, en.ts  <-- add new strings here, both files
src-tauri/
  src/               # Rust backend (commands, ssh, crypto, db, ...)
  capabilities/      # Tauri permissions
  tauri.conf.json    # app config + CSP
  Cargo.toml         # Rust deps
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design and [SECURITY.md](./SECURITY.md) for the security model.

## Making changes

1. Fork the repo and create a branch from `main`:
   ```powershell
   git checkout -b feat/my-feature
   ```
2. Make your change. Keep it focused — one feature/fix per PR is easier to review.
3. Frontend strings must go through i18n (`t('key')`) with keys added to **both** `src/i18n/locales/ru.ts` and `en.ts`.
4. Don't commit `node_modules/`, `dist/`, `src-tauri/target/`, `*.exe`, `*.db`, or anything from `.gitignore`. The `.gitignore` already excludes these — run `git status` before committing.
5. Verify before pushing:
   ```powershell
   npm run typecheck
   npm run lint
   npm run build
   ```
6. Write a clear commit message:
   ```
   feat(terminal): add font size setting
   fix(dashboard): reset network ref on server switch
   ```

## Opening a Pull Request

- Target `main`.
- Reference any related issue (`Closes #123`).
- Describe what changed and why; note anything not covered by tests.
- Make sure `npm run typecheck`, `npm run lint`, and `npm run build` pass locally.

## Security

If you found a security issue, please **don't** open a public issue — see [SECURITY.md](./SECURITY.md) for responsible disclosure.

## Code style

- TypeScript: strict, no `any` without reason, prefer explicit types on exported APIs.
- React: function components + hooks, CSS Modules for styles.
- Rust: follow `cargo fmt` + `cargo clippy`, prefer `Result` over `.unwrap()` in command handlers (panics poison the SSH mutex).
