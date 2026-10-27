# ServerPilot RU 1.0.0-beta.1

First beta release. The move from alpha includes critical stability fixes, security hardening, UX improvements and a set of new capabilities that bring the app closer to modern alternatives (Termius, Tabby, WindTerm).

---

## 🐛 Critical Bug Fixes

### BUG-001 — Dashboard hang while collecting network stats
**Symptom:** on the Dashboard page the network speed counters would eventually stop updating, and in some cases the UI froze.
**Cause:** `prevRx`/`prevTx` were stored in `useState` and included in `useCallback` deps, which recreated `fetchStats` on every tick and caused an endless `setInterval`/`clearInterval` loop. Additionally `fetchStats` was excluded from `useEffect` deps (stale closure).
**Fix:** `prevRx`/`prevTx` replaced with `useRef({ rx, tx })`. `useCallback` now depends only on `selectedServerId`, `useEffect` correctly includes `fetchStats`. The ref resets when the server changes.
**Files:** `src/pages/DashboardPage.tsx`

### BUG-004 — Corrupted backup archives on download
**Symptom:** downloaded `.tar.gz` archives failed CRC checks or were corrupted.
**Cause:** the classic `for (i…) bytes[i] = binary.charCodeAt(i)` loop after `atob()` mishandled high-bit bytes in some environments.
**Fix:** replaced with `Uint8Array.from(atob(b64), c => c.charCodeAt(0))`.
**Files:** `src/pages/BackupsPage.tsx`

### BUG-005 — `interval` name conflict in MonitoringPage
**Symptom:** the `interval` state variable shadowed the global `setInterval`, causing confusion and potential TypeScript errors.
**Fix:** renamed to `intervalSec`, value now loaded from `localStorage('metrics_interval_sec')`.
**Files:** `src/pages/MonitoringPage.tsx`

### BUG-006 — Command palette was not reachable
**Symptom:** `CommandPalette` existed in code but had neither a hotkey nor a render — the feature was inaccessible.
**Fix:** added `<CommandPalette />` render in `MainLayout` and the **Ctrl+K** hotkey.
**Files:** `src/components/layout/MainLayout.tsx`, `src/components/ui/CommandPalette.tsx`

### BUG-007 — Stale closure in `App.tsx`
**Symptom:** `loadServers` was missing from `useEffect` deps, which could lead to a stale call.
**Fix:** `useEffect` now depends on `[loadServers]`.
**Files:** `src/App.tsx`

### BUG-008 — Dead CSS without a component
**Symptom:** `PlaceholderPage.module.css` existed but the matching `.tsx` was missing.
**Fix:** created `src/pages/PlaceholderPage.tsx`.
**Files:** `src/pages/PlaceholderPage.tsx`

---

## 🛡 Security Fixes

### SEC-002 — AI API key storage
**Before:** AI provider keys were stored in plain `localStorage` and accessible to any JS code in the WebView.
**After:** keys moved to `sessionStorage` with backward compatibility (migrated from `localStorage` on first launch) and a TODO to switch to the encrypted Tauri plugin-store.
**Files:** `src/pages/AiPage.tsx`, `src/pages/SettingsPage.tsx`

### SEC-003 — AI provider URL validation
**Before:** the API URL was not validated — a user could enter `file:///`, `javascript:`, or `http://localhost:6379` (Redis).
**After:** both AI config components validate the URL before saving: only `http://` and `https://` are allowed, other schemes show an inline error and block saving.
**Files:** `src/pages/AiPage.tsx`, `src/pages/SettingsPage.tsx`

### CODE-003 — Docker ContainerDetail bypassed the SSH queue
**Before:** one call in `DockerPage` went directly through `invoke()`, bypassing `sshQueue`, which could deadlock under concurrent requests.
**After:** the call now goes through `sshInvoke` / `sshQueue` like the rest.
**Files:** `src/pages/DockerPage.tsx`

---

## ✨ New Features

### MISSING-009 — Auto-connect on startup
On app launch servers auto-connect (unless disabled in Settings → General). The toggle is persisted in `localStorage('auto_connect')`.
**Files:** `src/stores/serversStore.ts`, `src/App.tsx`, `src/pages/SettingsPage.tsx`

### MISSING-001 — Light theme
Added a `[data-theme='light']` block with light CSS variables. The theme switcher in Settings → Appearance now works (previously decorative). The choice is persisted in `localStorage('app_theme')` and restored on launch.
**Files:** `src/styles/globals.css`, `src/pages/SettingsPage.tsx`, `src/App.tsx`

### MISSING-005 — Export/import server configuration
Settings → General now has a "Data" section. Export dumps the server list to JSON (without credentials). Import reads JSON and adds the servers. Important when reinstalling Windows.
**Files:** `src/pages/SettingsPage.tsx`

### MISSING-006 — Command history
Settings → General has a section showing the last 50 commands from the DB: command (first 80 chars), server, exit code. A refresh button is included.
**Files:** `src/pages/SettingsPage.tsx`

### MISSING-004 — Metric alerts on Dashboard
`notificationsService.checkThreshold()` is now also called on Dashboard (previously only on Monitoring). The user gets CPU/RAM/Disk threshold notifications wherever they are.
**Files:** `src/pages/DashboardPage.tsx`

### UX-004 — Hotkeys
- **Ctrl+K** — command palette
- **Alt+1..9** — section navigation
**Files:** `src/components/layout/MainLayout.tsx`

### UX-003 — "Open" button in ServersPage
The button now not only selects the server but also navigates to Dashboard.
**Files:** `src/pages/ServersPage.tsx`

---

## 🐛 Three user-reported bugs

### NEW-BUG-001 — Window did not remember size/position
**Symptom:** on relaunch the window opened at the default size, not the one it was closed in.
**Fix:** added `onResized`/`onMoved` listeners via `@tauri-apps/api/window`. Size and position are persisted in `localStorage('window_state')` and restored on startup via `setSize`/`setPosition`. Wrapped in `try/catch` for dev mode without Tauri.
**Files:** `src/App.tsx` (or `src/main.tsx`)

### NEW-BUG-002 — Modal closed on accidental click while pasting
**Symptom:** pasting (Ctrl+V) text into a modal and then accidentally clicking outside closed the window and lost the data.
**Fix:** backdrop-click closing is disabled when the form is "dirty" (has unsaved changes). `event.stopPropagation()` added on the modal container. Closing — only via the explicit Cancel button or Escape (with confirmation if dirty).
**Files:** `src/pages/ServersPage.tsx` (ServerFormModal and similar)

### NEW-BUG-003 — Double paste in the PTY terminal on reconnect
**Symptom:** on reconnect to an SSH session the typed text was duplicated — xterm received the data twice.
**Cause:** on reconnect the old `terminal.onData()` subscriber was not disposed before the new subscription, and the polling interval could start twice.
**Fix:** `dispose()` of the old subscriber is called before the new subscription. `clearInterval` is called before restarting polling. Added an `isConnected` flag to prevent a double `onData` subscribe.
**Files:** `src/features/terminal/PtyTerminal.tsx`

---

## 🔧 Code Quality

### CODE-001 — Extract `classifyRisk` into a shared utility
The duplicated function in `AiPage.tsx` and `ScriptsPage.tsx` was moved to `src/utils/classifyRisk.ts` and imported in both files.

### CODE-002 — Full i18n in ServersPage
Removed hardcoded Russian strings ("🔑 пароль", "Открыть", "Изменить", "Удалить сервер?" etc.). All strings go through `t()` with new keys in `src/i18n/locales/ru.ts` and `en.ts`.

### CODE-005 — Persisted language choice
i18next now reads the saved language from `localStorage` on init. The language chosen in Settings persists across sessions.

### CODE-007 — Clear state on server switch
When switching a server in the sidebar, stale metrics/history no longer linger on screen. `DashboardPage` resets `prevNetRef`, `MonitoringPage` resets `history` and `latest`.

### CODE-009 — Retry in `sshQueue`
Added retry logic for network errors: `MAX_RETRIES = 2`, `RETRY_DELAY_MS = 1500` with exponential backoff. Retry fires only on `connection`/`session`/`channel`/`eof`/`timeout` errors.

### CODE-006 — ErrorBoundary
The router in `App.tsx` is wrapped in `ErrorBoundary`. On a JS error in any component the app no longer shows a white screen — a recovery message with a button is shown.

### MISSING-002 — SettingsPage metrics interval
The metrics interval select in Settings → General is now controlled: the value is read from `localStorage('metrics_interval_sec')` and saved on change.

---

## 📦 Build

- Product version bumped to `1.0.0-beta.1` (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`).
- `productName` changed from "ServerPilot RU Alpha" to "ServerPilot RU".
- `npm run typecheck`, `npm run lint`, `npm run build` pass without errors (exit 0).
- Build target: NSIS installer for Windows x64 (`ServerPilot RU_1.0.0-beta.1_x64-setup.exe`).

---

## 📝 Known Limitations

- **SEC-001 (KDF):** master key derivation uses SHA-256(MachineGUID + AppID). The README mentions PBKDF2 — the actual implementation is SHA-256. Hardening to PBKDF2/Argon2id with a DB salt is planned for the stable release (requires migrating existing credentials).
- **SEC-004 (SSH host key pinning):** the server fingerprint is returned but not stored or verified on subsequent connections. Implementing pinning with a first-connect confirmation is planned for the stable release.
- **MISSING-010 (AI config in SQLite):** the `ai_providers` table exists in the DB but the frontend still uses `sessionStorage`. Moving it to encrypted SQLite is planned.

---

## 🚀 Installation

Download `ServerPilot.RU_1.0.0-beta.1_x64-setup.exe` from the [Releases](https://github.com/zMEGA-Dev/serverpilot_ru/releases) page and run the installer. Minimum requirements: Windows 10/11 x64.

## 🔗 Links

- Repository: https://github.com/zMEGA-Dev/serverpilot_ru
- Issues: https://github.com/zMEGA-Dev/serverpilot_ru/issues

---
---

# 🇷🇺 Русская версия

# ServerPilot RU 1.0.0-beta.1

Первый beta-релиз. Переход с alpha включает критические исправления стабильности, усиление безопасности, доработку UX и ряд новых возможностей, приближающих приложение к современным аналогам (Termius, Tabby, WindTerm).

---

## 🐛 Критические исправления

### BUG-001 — Зависание Dashboard при сборе network-статистики
**Симптом:** на странице Dashboard со временем счётчики скорости сети переставали обновляться, в ряде случаев интерфейс зависал.
**Причина:** `prevRx`/`prevTx` хранились в `useState` и попадали в зависимости `useCallback`, что приводило к пересозданию `fetchStats` на каждом тике и бесконечному циклу `setInterval`/`clearInterval`. Дополнительно `fetchStats` был исключён из зависимостей `useEffect` (stale closure).
**Фикс:** `prevRx`/`prevTx` заменены на `useRef({ rx, tx })`. `useCallback` теперь зависит только от `selectedServerId`, `useEffect` корректно включает `fetchStats`. Ref сбрасывается при смене сервера.
**Файлы:** `src/pages/DashboardPage.tsx`

### BUG-004 — Повреждённые backup-архивы при скачивании
**Симптом:** скачанные `.tar.gz` архивы открывались с ошибками CRC или были повреждены.
**Причина:** классический цикл `for (i…) bytes[i] = binary.charCodeAt(i)` после `atob()` некорректно обрабатывал байты со старшим битом в некоторых окружениях.
**Фикс:** заменено на `Uint8Array.from(atob(b64), c => c.charCodeAt(0))`.
**Файлы:** `src/pages/BackupsPage.tsx`

### BUG-005 — Конфликт имён `interval` в MonitoringPage
**Симптом:** state-переменная `interval` перекрывала глобальный `setInterval`, что приводило к путанице и потенциальным TypeScript-ошибкам.
**Фикс:** переменная переименована в `intervalSec`, значение загружается из `localStorage('metrics_interval_sec')`.
**Файлы:** `src/pages/MonitoringPage.tsx`

### BUG-006 — Командная палитра не была доступна пользователю
**Симптом:** `CommandPalette` существовал в коде, но не имел ни горячей клавиши, ни рендера — функциональность была недоступна.
**Фикс:** добавлен рендер `<CommandPalette />` в `MainLayout` и горячая клавиша **Ctrl+K**.
**Файлы:** `src/components/layout/MainLayout.tsx`, `src/components/ui/CommandPalette.tsx`

### BUG-007 — Stale closure в `App.tsx`
**Симптом:** `loadServers` не был в зависимостях `useEffect`, что теоретически могло давать устаревший вызов.
**Фикс:** `useEffect` теперь зависит от `[loadServers]`.
**Файлы:** `src/App.tsx`

### BUG-008 — Мёртвый CSS без компонента
**Симптом:** `PlaceholderPage.module.css` существовал, но соответствующий `.tsx` отсутствовал.
**Фикс:** создан `src/pages/PlaceholderPage.tsx`.
**Файлы:** `src/pages/PlaceholderPage.tsx`

---

## 🛡 Исправления безопасности

### SEC-002 — Хранение AI API-ключей
**Было:** ключи AI-провайдеров хранились в `localStorage` открытым текстом и были доступны любому JS-коду в WebView.
**Стало:** ключи перенесены в `sessionStorage` с обратной совместимостью (миграция из `localStorage` при первом запуске) и TODO-комментарием на переход к encrypted store через Tauri plugin-store.
**Файлы:** `src/pages/AiPage.tsx`, `src/pages/SettingsPage.tsx`

### SEC-003 — Валидация URL AI-провайдера
**Было:** URL API не валидировался — пользователь мог ввести `file:///`, `javascript:` или `http://localhost:6379` (Redis).
**Стало:** оба AI-конфиг-компонента валидируют URL перед сохранением: разрешены только `http://` и `https://`, остальные схемы показывают inline-ошибку и блокируют сохранение.
**Файлы:** `src/pages/AiPage.tsx`, `src/pages/SettingsPage.tsx`

### CODE-003 — Docker ContainerDetail обходил очередь SSH
**Было:** один из вызовов в `DockerPage` шёл напрямую через `invoke()`, минуя `sshQueue`, что могло вызывать deadlock при конкурентных запросах.
**Стало:** вызов переведён на `sshInvoke` через `sshQueue`, как и остальные.
**Файлы:** `src/pages/DockerPage.tsx`

---

## ✨ Новые возможности

### MISSING-009 — Автоподключение при старте приложения
При запуске приложения серверы автоматически подключаются (если не отключено в Settings → General). Toggle запоминается в `localStorage('auto_connect')`.
**Файлы:** `src/stores/serversStore.ts`, `src/App.tsx`, `src/pages/SettingsPage.tsx`

### MISSING-001 — Светлая тема
Добавлен блок `[data-theme='light']` со светлыми CSS-переменными. Переключатель темы в Settings → Appearance теперь работает (ранее был декоративным). Выбор сохраняется в `localStorage('app_theme')` и восстанавливается при запуске.
**Файлы:** `src/styles/globals.css`, `src/pages/SettingsPage.tsx`, `src/App.tsx`

### MISSING-005 — Экспорт/импорт конфигурации серверов
В Settings → General добавлена секция «Данные». Экспорт выгружает список серверов в JSON (без credentials). Импорт читает JSON и добавляет серверы. Важно при переустановке Windows.
**Файлы:** `src/pages/SettingsPage.tsx`

### MISSING-006 — История команд
В Settings → General добавлена секция с последними 50 командами из БД: команда (первые 80 символов), сервер, exit-код. Кнопка обновления.
**Файлы:** `src/pages/SettingsPage.tsx`

### MISSING-004 — Алерты метрик на Dashboard
`notificationsService.checkThreshold()` теперь вызывается и на Dashboard (ранее только на Monitoring). Пользователь получает уведомления о превышении порогов CPU/RAM/Disk, где бы он ни находился.
**Файлы:** `src/pages/DashboardPage.tsx`

### UX-004 — Горячие клавиши
- **Ctrl+K** — командная палитра
- Числовые клавиши **Alt+1..9** — навигация по разделам
**Файлы:** `src/components/layout/MainLayout.tsx`

### UX-003 — Кнопка «Открыть» в ServersPage
Кнопка теперь не только выбирает сервер, но и навигирует на Dashboard.
**Файлы:** `src/pages/ServersPage.tsx`

---

## 🐛 Три бага, замеченные пользователем

### NEW-BUG-001 — Окно не запоминало размер/позицию
**Симптом:** при повторном запуске окно открывалось в дефолтном размере, не в том, в котором было закрыто.
**Фикс:** добавлены слушатели `onResized`/`onMoved` через `@tauri-apps/api/window`. Размер и позиция сохраняются в `localStorage('window_state')` и восстанавливаются при старте через `setSize`/`setPosition`. Обёрнуто в `try/catch` на случай dev-режима без Tauri.
**Файлы:** `src/App.tsx`

### NEW-BUG-002 — Модальное окно закрывалось при случайном клике во время вставки
**Симптом:** при вставке (Ctrl+V) текста в поля модалки случайный клик за её пределами закрывал окно и данные терялись.
**Фикс:** закрытие по клику на backdrop отключено, если форма в «dirty» state (есть несохранённые изменения). На модальный контейнер добавлен `event.stopPropagation()`. Закрытие — только по явной кнопке Cancel или Escape (с подтверждением, если есть несохранённые данные).
**Файлы:** `src/pages/ServersPage.tsx` (ServerFormModal и аналогичные)

### NEW-BUG-003 — Двойная вставка в PTY-терминале при переподключении
**Симптом:** при переподключении к SSH-сессии вводимый текст дублировался — xterm получал данные дважды.
**Причина:** при переподключении старый подписчик `terminal.onData()` не удалялся перед новой подпиской, а polling interval мог запускаться дважды.
**Фикс:** `dispose()` старого подписчика вызывается перед новой подпиской. `clearInterval` очищается перед повторным запуском polling. Добавлен флаг `isConnected`, предотвращающий двойной subscribe.
**Файлы:** `src/features/terminal/PtyTerminal.tsx`

---

## 🔧 Улучшения качества кода

### CODE-001 — Вынос `classifyRisk` в shared utility
Дублирующаяся функция в `AiPage.tsx` и `ScriptsPage.tsx` вынесена в `src/utils/classifyRisk.ts` и импортируется в обоих файлах.

### CODE-002 — Полная i18n в ServersPage
Убраны хардкодные русские строки. Все строки переведены через `t()` с добавлением ключей в `src/i18n/locales/ru.ts` и `en.ts`.

### CODE-005 — Сохранение выбора языка
i18next теперь читает сохранённый язык из `localStorage` при инициализации. Выбор языка в Settings сохраняется между сессиями.

### CODE-007 — Очистка state при смене сервера
При переключении сервера в sidebar старые метрики/история больше не остаются на экране. `DashboardPage` сбрасывает `prevNetRef`, `MonitoringPage` сбрасывает `history` и `latest`.

### CODE-009 — Retry в `sshQueue`
Добавлена логика повторных попыток при сетевых ошибках: `MAX_RETRIES = 2`, `RETRY_DELAY_MS = 1500` с экспоненциальной задержкой. Retry срабатывает только на `connection`/`session`/`channel`/`eof`/`timeout` ошибках.

### CODE-006 — ErrorBoundary
Роутер в `App.tsx` обёрнут в `ErrorBoundary`. При JS-ошибке в любом компоненте приложение больше не показывает белый экран — отображается сообщение с кнопкой восстановления.

### MISSING-002 — SettingsPage metrics interval
Select для интервала метрик в Settings → General теперь управляемый: значение читается из `localStorage('metrics_interval_sec')` и сохраняется при изменении.

---

## 📦 Сборка

- Версия продукта поднята до `1.0.0-beta.1` (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`).
- `productName` изменён с «ServerPilot RU Alpha» на «ServerPilot RU».
- `npm run typecheck`, `npm run lint`, `npm run build` проходят без ошибок (exit 0).
- Цель сборки: NSIS-установщик для Windows x64 (`ServerPilot RU_1.0.0-beta.1_x64-setup.exe`).

---

## 📝 Известные ограничения

- **SEC-001 (KDF):** для деривации мастер-ключа используется SHA-256(MachineGUID + AppID). README упоминает PBKDF2 — фактическая реализация SHA-256. Усиление до PBKDF2/Argon2id с солью в БД запланировано на стабильный релиз.
- **SEC-004 (SSH host key pinning):** fingerprint сервера возвращается, но не сохраняется и не проверяется при повторных подключениях. Реализация pinning с подтверждением при первом подключении запланирована на стабильный релиз.
- **MISSING-010 (AI config в SQLite):** таблица `ai_providers` существует в БД, но frontend пока использует `sessionStorage`. Перенос в encrypted SQLite запланирован.

---

## 🚀 Установка

Скачайте `ServerPilot.RU_1.0.0-beta.1_x64-setup.exe` со страницы [Releases](https://github.com/zMEGA-Dev/serverpilot_ru/releases) и запустите установщик. Минимальные требования: Windows 10/11 x64.

## 🔗 Ссылки

- Репозиторий: https://github.com/zMEGA-Dev/serverpilot_ru
- Issues: https://github.com/zMEGA-Dev/serverpilot_ru/issues
