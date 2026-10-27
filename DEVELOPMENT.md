# Руководство разработчика

## Требования к окружению

| Инструмент | Версия | Установка |
|---|---|---|
| Rust | 1.75+ | https://rustup.rs/ |
| Node.js | 20 LTS+ | https://nodejs.org/ |
| Visual Studio Build Tools | 2022 | https://visualstudio.microsoft.com/visual-cpp-build-tools/ |
| WebView2 Runtime | latest | Уже есть в Windows 11; для Win10: https://developer.microsoft.com/en-us/microsoft-edge/webview2/ |

## Первый запуск

```bash
# Клонируйте репозиторий
cd server-pilot-ru

# Установить npm зависимости
npm install

# Запустить в режиме разработки (открывается окно приложения)
npm run tauri:dev
```

## Структура команд

| Команда | Описание |
|---|---|
| `npm run dev` | Только Vite dev server (без Tauri) |
| `npm run tauri:dev` | Полный dev режим с hot reload |
| `npm run build` | Сборка фронтенда |
| `npm run tauri:build` | Полная сборка .exe |
| `npm run typecheck` | TypeScript проверка |
| `npm run lint` | ESLint |
| `npm test` | Тесты (Vitest) |

## Работа с Rust backend

```bash
cd src-tauri

# Проверка кода (быстро, без линковки)
cargo check

# Запуск тестов
cargo test

# Форматирование
cargo fmt

# Линтер
cargo clippy
```

## Добавление новой Tauri команды

1. Создайте функцию в `src-tauri/src/commands/`:

```rust
#[tauri::command]
pub fn my_command(state: State<AppState>, param: String) -> Result<String, String> {
    // ...
    Ok("result".to_string())
}
```

2. Зарегистрируйте в `src-tauri/src/lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::my_module::my_command,
    // ...
])
```

3. Вызывайте с фронтенда:

```typescript
import { invoke } from "@tauri-apps/api/core";
const result = await invoke<string>("my_command", { param: "value" });
```

## Добавление новой страницы

1. Создайте `src/pages/MyPage.tsx` и `src/pages/MyPage.module.css`
2. Добавьте маршрут в `src/App.tsx`
3. Добавьте пункт в навигацию в `src/components/layout/Sidebar.tsx`
4. Добавьте строку локализации в `src/i18n/locales/ru.ts` и `en.ts`

## Локализация

Все строки интерфейса — в `src/i18n/locales/ru.ts`. Используйте хук:

```typescript
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t } = useTranslation();
  return <span>{t("nav.dashboard")}</span>;
}
```

## Отладка

### Открыть DevTools

В dev-режиме: правый клик → "Inspect Element" или `F12`.

### Логи приложения

Rust логи пишутся в `%LOCALAPPDATA%\ServerPilotRU\logs\app.log` (ротация при превышении 5 МБ → `app.old.log`).
В dev-режиме дополнительно выводятся в консоль.

### SQLite база данных

```
%LOCALAPPDATA%\ServerPilotRU\data.db
```

Для просмотра используйте [DB Browser for SQLite](https://sqlitebrowser.org/).
