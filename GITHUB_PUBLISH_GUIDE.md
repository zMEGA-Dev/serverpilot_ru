# Инструкция по публикации на GitHub (только бинарник, Windows)

Цель: публичный репозиторий только с installer и документацией.
Исходный код остаётся у тебя локально и никуда не уходит.

---

## Шаг 1 — Создай отдельную папку для публикации

Открой Проводник и создай новую папку, например:
```
C:\Users\zmega\Downloads\server-pilot-ru-release
```

НЕ используй папку `server-pilot-ru` — там исходники.

---

## Шаг 2 — Скопируй только нужные файлы

Скопируй из `C:\Users\zmega\Downloads\server-pilot-ru\` в новую папку ТОЛЬКО эти файлы:

```
README.md
README_RU.md
LICENSE
SECURITY.md
ARCHITECTURE.md
RELEASE_TEST_PLAN.md
```

Просто перетащи их в Проводнике или через PowerShell:

```powershell
$src = "C:\Users\zmega\Downloads\server-pilot-ru"
$dst = "C:\Users\zmega\Downloads\server-pilot-ru-release"
New-Item -ItemType Directory -Path $dst -Force

Copy-Item "$src\README.md"              $dst
Copy-Item "$src\README_RU.md"           $dst
Copy-Item "$src\LICENSE"                $dst
Copy-Item "$src\SECURITY.md"            $dst
Copy-Item "$src\ARCHITECTURE.md"        $dst
Copy-Item "$src\RELEASE_TEST_PLAN.md"   $dst
```

НЕ копируй папки: `src`, `src-tauri`, `node_modules`, `dist`
НЕ копируй файлы: `package.json`, `*.ts`, `*.tsx`, `*.rs`, `*.toml`

---

## Шаг 3 — Создай .gitignore в папке релиза

В папке `server-pilot-ru-release` создай файл `.gitignore` с содержимым:

```
# Страховка — исходный код никогда не попадёт в git
src/
src-tauri/
node_modules/
dist/
*.ts
*.tsx
*.rs
*.toml
package*.json
.env*
*.exe
*.msi
*.db
```

Это защита на случай если случайно скопируешь лишнее.

---

## Шаг 4 — Создай репозиторий на GitHub

1. Открой [github.com/new](https://github.com/new) в браузере
2. Repository name: `server-pilot-ru`
3. Visibility: **Public**
4. **НЕ ставь галочки** "Add README", "Add .gitignore", "Choose license" — у тебя всё уже есть
5. Нажми **Create repository**
6. GitHub покажет страницу с инструкцией — скопируй ссылку репозитория вида `https://github.com/ТВОЙ_ЛОГИН/server-pilot-ru.git`

---

## Шаг 5 — Инициализируй git и запушь

Открой PowerShell и выполни:

```powershell
cd "C:\Users\zmega\Downloads\server-pilot-ru-release"

git init
git add README.md README_RU.md LICENSE SECURITY.md ARCHITECTURE.md RELEASE_TEST_PLAN.md
git status
```

**Проверь вывод `git status`** — должны быть только .md файлы и LICENSE.
Если видишь что-то лишнее (.ts, .rs, .json) — не продолжай, удали это из папки.

Если всё чисто:

```powershell
git commit -m "Initial release: ServerPilot RU Alpha 1.0.0-alpha.1"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/server-pilot-ru.git
git push -u origin main
```

---

## Шаг 6 — Добавь installer через GitHub Releases

Installer добавляется не через git, а через веб-интерфейс GitHub:

1. Зайди на страницу репозитория в браузере
2. Справа найди раздел **Releases** → нажми **Create a new release**
3. **Tag:** `v1.0.0-alpha.1`
4. **Release title:** `ServerPilot RU Alpha 1.0.0-alpha.1`
5. В описании напиши кратко что это Alpha
6. Внизу **Attach binaries** — перетащи файл:
   ```
   C:\Users\zmega\Downloads\server-pilot-ru\src-tauri\target\release\bundle\nsis\ServerPilot RU Alpha_1.0.0-alpha.1_x64-setup.exe
   ```
7. Поставь галочку **Set as a pre-release** (это Alpha)
8. Нажми **Publish release**

---

## Шаг 7 — Обнови ссылки в README

После публикации открой `README.md` и `README_RU.md` в папке релиза и замени:
```
../../releases
../../issues
```
на реальные ссылки:
```
https://github.com/ТВОЙ_ЛОГИН/server-pilot-ru/releases
https://github.com/ТВОЙ_ЛОГИН/server-pilot-ru/issues
```

Потом снова:
```powershell
cd "C:\Users\zmega\Downloads\server-pilot-ru-release"
git add README.md README_RU.md
git commit -m "fix: update GitHub links"
git push
```

---

## Итоговая структура того что будет на GitHub

```
server-pilot-ru/          ← публичный репозиторий
├── README.md
├── README_RU.md
├── LICENSE
├── SECURITY.md
├── ARCHITECTURE.md
├── RELEASE_TEST_PLAN.md
└── Releases/
    └── ServerPilot RU Alpha_1.0.0-alpha.1_x64-setup.exe
```

Исходники остаются только у тебя в `C:\Users\zmega\Downloads\server-pilot-ru\`.

---

## Правило на будущее

Каждый раз перед `git push` выполняй:
```powershell
git status
```
И смотри список файлов. Только .md и LICENSE — пушишь. Всё остальное — стоп.
