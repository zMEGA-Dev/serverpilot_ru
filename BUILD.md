# Сборка ServerPilot RU

## Dev сборка

```bash
npm run tauri:dev
```

Открывает окно приложения с hot reload. Изменения в `src/` применяются мгновенно. Изменения в `src-tauri/` требуют перезапуска.

## Production сборка

```bash
npm run tauri:build
```

Результат в `src-tauri/target/release/bundle/`:

```
bundle/
├── nsis/
│   └── ServerPilot-RU_1.0.0_x64-setup.exe   ← Installer
├── msi/
│   └── ServerPilot-RU_1.0.0_x64_en-US.msi   ← MSI пакет
└── ...
```

## Требования для сборки на Windows

1. **Rust** + MSVC toolchain (`rustup target add x86_64-pc-windows-msvc`)
2. **Visual Studio Build Tools 2022** с компонентом "Desktop development with C++"
3. **NSIS** для создания installer:
   - Скачать: https://nsis.sourceforge.io/Download
   - Добавить в PATH

## Portable версия

Tauri по умолчанию собирает installer. Для portable .exe:

```bash
# В src-tauri/tauri.conf.json установите:
# "bundle": { "targets": ["nsis"] }

# Найдите .exe внутри установленного приложения:
# %PROGRAMFILES%\ServerPilot RU\ServerPilot-RU.exe
```

Или скопируйте файлы из `target/release/` вместе с WebView2 runtime.

## Генерация иконок

```bash
# Из корня проекта (нужен PNG 1024x1024 в src-tauri/icons/icon.png)
npx @tauri-apps/cli icon src-tauri/icons/icon.png
```

Генерирует все нужные размеры: ICO, PNG, ICNS.

## Автоматическое обновление

Tauri поддерживает updater через `tauri-plugin-updater`. Конфигурация в `tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "...",
    "endpoints": ["https://releases.example.com/{{target}}/{{arch}}/{{current_version}}"]
  }
}
```

Перед обновлением приложение автоматически делает backup SQLite базы.
