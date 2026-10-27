# License Architecture — ServerPilot RU

> **Статус:** Архитектурный документ для будущей коммерческой версии.
> Alpha-версия работает **без лицензионного сервера** и без обязательной активации.
> Эта система будет внедрена только в коммерческой версии.

---

## Принципы

```
ServerPilot Client
       ↓
  License API
       ↓
Signed License Token
       ↓
Public-key verification in client
```

**Главное правило:** private signing key **никогда** не находится в клиентском приложении.

| Где хранится | Что содержит |
|---|---|
| License Server (private) | Private signing key, база лицензий, платёжная интеграция |
| Client (public) | Только public key для проверки подписи |

---

## Структура License Token

Формат: **JWT (JSON Web Token)** с подписью RS256 или Ed25519.

```json
{
  "product": "serverpilot-ru",
  "license_id": "uuid-v4",
  "plan": "monthly",
  "issued_at": 1700000000,
  "expires_at": 1702678400,
  "installation_id": "hash-of-machine-id",
  "features": ["ssh", "terminal", "monitoring", "docker", "ai"],
  "version_max": "2.x",
  "revoked": false
}
```

Подпись: `RS256` или `Ed25519` — проверяется клиентом через встроенный public key.

---

## Типы лицензий

| Тип | Описание | expires_at |
|---|---|---|
| `alpha` | Бесплатная Alpha — без ограничений | null (бессрочно) |
| `trial` | Пробный период, 14 дней | issued_at + 14 дней |
| `monthly` | Ежемесячная подписка | дата следующего платежа |
| `yearly` | Годовая подписка | дата следующего платежа |
| `lifetime` | Бессрочная лицензия | null |
| `revoked` | Отозванная | любая — `revoked: true` |

---

## Верификация на клиенте

```
1. Загрузить token из локального хранилища
2. Проверить криптографическую подпись public key-ом
3. Проверить expires_at < now()
4. Проверить revoked == false
5. Проверить installation_id == текущий machine ID
6. Проверить product == "serverpilot-ru"
7. Если всё OK → разрешить использование
```

Если token отсутствует или невалиден → показать UI для активации или работать в режиме Alpha/Trial.

---

## Защита от атак

### Подделка token
- Без private key сгенерировать валидный токен невозможно
- Изменение любого поля инвалидирует подпись
- Клиент не принимает неподписанные или самоподписанные токены

### Clock rollback
- `issued_at` + `server_time` при активации: клиент сохраняет `last_verified_at`
- При следующем запуске: если системное время < `last_verified_at` — подозрение на rollback
- Онлайн-проверка при значительном расхождении

### Клонирование activation
- `installation_id` = SHA-256(MachineGuid + product)
- Token привязан к конкретному `installation_id`
- Тот же token на другой машине → проверка провалится

### Бесконечный trial
- `trial` токен выдаётся **один раз** по email
- Повторный запрос trial для того же email → отклонить
- `installation_id` в базе сервера — не более одного trial на машину

### Revocation
- Сервер ведёт список `revoked_license_ids`
- Клиент проверяет revocation list при онлайн-активации и периодически
- Офлайн: используется `revoked` flag внутри token (обновляется при следующей проверке)

### Изменение plan/features
- Любое изменение JSON инвалидирует подпись → невозможно без private key

---

## Что содержит клиент (public, допустимо в Git)

```rust
// Встроенный public key для верификации лицензий
// Private key хранится ТОЛЬКО на license server
const LICENSE_PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----
... (Ed25519 или RSA public key) ...
-----END PUBLIC KEY-----";
```

## Что НЕ должно быть в клиенте и Git

- `-----BEGIN PRIVATE KEY-----` или `-----BEGIN RSA PRIVATE KEY-----`
- Stripe secret key (`sk_live_*`, `sk_test_*`)
- License server database credentials
- Payment webhook secrets
- Admin API keys

---

## License Server API (будущее)

```
POST /api/v1/activate
  { license_key, installation_id, product, version }
  → { token: "jwt...", expires_at }

POST /api/v1/refresh
  { token, installation_id }
  → { token: "jwt...", expires_at }

POST /api/v1/revoke
  { license_id }   # admin only
  → { ok: true }

GET /api/v1/trial
  { email, installation_id }
  → { token: "jwt..." }
```

---

## Alpha / Open Source слой

```
OPEN (публично, в Git):
├── src/                    — весь React/TS frontend
├── src-tauri/src/          — весь Rust backend
├── src-tauri/capabilities/ — Tauri permissions
├── README.md
├── LICENSE_ARCHITECTURE.md
├── SECURITY.md
└── Alpha build (.exe)

PRIVATE (не в Git, только на license server):
├── private-key.pem         — signing key
├── license-server/         — backend лицензирования
├── payment/                — Stripe integration
├── anti-abuse/             — rate limiting, fraud detection
└── admin-panel/            — управление лицензиями
```

---

## Текущее состояние (Alpha)

В Alpha-версии лицензионная система **не активна**:

- Нет проверки лицензии при запуске
- Нет ограничений по features
- Нет online activation
- Public key не встроен (нечего проверять)
- Все функции доступны бесплатно

Это будет изменено только в коммерческой версии.

---

*Документ актуален для: ServerPilot RU 1.0.0-alpha.1*
*Последнее обновление: 2026*
