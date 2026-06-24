# mamacita — Valencia Cita Previa Monitor (Padrón)

Catches a `cita previa` (appointment) slot for **empadronamiento (padrón) in
Valencia**. The tool polls the municipal QSIGE backend and, the moment a slot
appears, sends a Telegram alert with everything needed to finish the booking
**manually in under a minute** — a human solves the captcha and clicks submit.

See the full product spec in [PRD #1](https://github.com/Shandin17/mamacita/issues/1).

> **Phase 1 only.** Captcha solving and auto-submit are intentionally out of
> scope (PRD §9). The monitor notifies; you book by hand.

## Requirements

- Node.js 22+ (uses native TypeScript type-stripping and built-in `fetch`)
- A Telegram bot token + chat id (for alerts)

## Setup

```bash
npm install
cp config.example.json config.json   # then edit config.json
```

`config.json` is gitignored — keep your real values there. Secrets can also be
supplied via env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`TARGET_SERVICIO`, `TARGET_CENTRO`, `POLL_BASE_SEC`, `POLL_JITTER_SEC`,
`POLL_TIMEZONE`, `BACKOFF_BASE_SEC`, `BACKOFF_FACTOR`, `BACKOFF_CAP_SEC`,
`MANUAL_COOKIE`, `HEARTBEAT_HOUR`, `DEGRADED_THRESHOLD`, `STATUS_COMMAND`),
which override the file.

`config.json` shape (see `config.example.json`):

```json
{
  "target": { "servicio": 16, "centro": 5, "label": "Junta de Distrito Transits" },
  "telegram": { "botToken": "", "chatId": "" },
  "backoff":  { "baseSec": 30, "factor": 2, "capSec": 900 },
  "manualCookie": "",
  "profile": {
    "nombre": "",
    "apellidos": "",
    "tipoDocumento": "NIF/NIE",
    "documento": "",
    "telefono": "600000000",
    "email": "you@example.com",
    "observaciones": "Alta en el padrón"
  }
}
```

### Session resilience (F5 anti-bot)

The monitor keeps an in-memory **cookie jar**: it parses `set-cookie`
(`JSESSIONID` + the F5 `TS*` cookies) from every response and resends them on
each request. When a JSON endpoint answers with HTML, a non-JSON content type,
a `403`, or unparseable JSON, the session is treated as **dead** — when a whole
cycle is blocked the loop re-bootstraps (re-`GET`s the SPA index) and applies
**exponential backoff** (`baseSec` → ×`factor`, capped at `capSec` ≈ 15 min)
before resuming. A healthy cycle resets the backoff. All of this is logged.

**Manual cookie fallback:** F5 cookies live only a few hours. If automatic
bootstrap ever stops working, open the booking page in a browser, copy the
`Cookie` request header from DevTools (Network tab), and paste it into
`manualCookie` (or the `MANUAL_COOKIE` env var). It's seeded into the jar on
startup and after every re-bootstrap, so it survives rotation as a fallback.

## Running the monitor

```bash
npm start        # one poll → alert on hit
```

When a slot is found you get a Telegram message with the service/center, the
detected date(s), and an inline **→ Abrir formulario** button that deep-links
straight to the Angular booking form. The message also reminds you of the
manual flow: open the form, click your **Autofill** bookmarklet, solve the
captcha, and press **Acceptar**.

## State, de-dup & date filtering

To avoid alert storms when a slot lingers across many poll cycles, the monitor
keeps per-target state (in memory, and optionally mirrored to a JSON file):

- A slot is alerted **once per distinct signature** (its eligible dates, or a
  hash of the raw payload when the structure is opaque).
- It only **re-alerts** after the `state.cooldownSec` cooldown elapses, or if
  the slot disappears and later reappears.
- Set `state.file` (e.g. `state.json`) so de-dup **survives a restart**; leave
  it unset to keep state in memory only.
- `minDateISO` (default `2026-06-27`) drops bookable dates earlier than the
  floor **when the structure exposes parseable dates**; an opaque structure
  still alerts and lets you judge.
- On the **first real HIT**, the raw §3.2 + §3.3 payloads are dumped under
  `state.captureDir` (default `captures/`) — the only way to learn the
  populated `dias` shape and the future booking POST contract.

Relevant env overrides: `MIN_DATE_ISO`, `STATE_FILE`, `ALERT_COOLDOWN_SEC`.

## Liveness (heartbeat, degraded alert, `/status`)

Home-grown cita monitors usually die silently when cookies rotate. Three
liveness signals make that visible (config block `liveness`):

- **Daily heartbeat** — once per day, on or after `heartbeatHour` (local time of
  the schedule timezone; default `9` → 09:00 Europe/Madrid), a "💓 Monitor
  activo" message confirms the loop is alive and shows the last poll time and
  per-target state. Set `heartbeatHour: -1` to disable.
- **Degraded-state alert** — after `degradedThreshold` (default `3`) consecutive
  **fully-failed** cycles (every target blocked / non-JSON / dead session), a
  "⚠️ Monitor degradado" alert fires **once**; a single "✅ Monitor recuperado"
  follows when a healthy cycle returns. It never re-alerts every blocked cycle.
- **`/status` command** — when `statusCommand` is `true` (default), the loop
  polls Telegram `getUpdates` each cycle and answers `/status` on demand with
  the last poll time, per-target last result, and current backoff state. Works
  even while the monitor is degraded.

These messages are plain text and never interfere with HIT slot alerts.
Env overrides: `HEARTBEAT_HOUR`, `DEGRADED_THRESHOLD`, `STATUS_COMMAND`.

## Autofill bookmarklet (one-time install)

Because the booking form is an Angular SPA, fields cannot be prefilled via the
URL. Instead, install a tiny bookmarklet **once**; clicking it after the form
loads fills all seven fields — `Nom`, `Cognoms`, `Tipus de document`,
`Document`, `Telèfon`, `Email`, `Observacions` — from your `profile` and fires
the `input`/`change` events Angular needs to register them.

The bookmarklet **never touches the captcha and never clicks Acceptar** — those
stay 100% manual by design (PRD §9).

### 1. Generate it from your profile

```bash
npm run autofill              # prints the .js snippet and the bookmarklet
npm run autofill -- autofill.js   # also writes the readable snippet to a file
```

This reads the `profile` from `config.json` (Telegram credentials are not
required) and prints two things:

- a **readable `.js` snippet** you can inspect or paste into the browser console, and
- a **one-line `javascript:` bookmarklet**.

### 2. Install the bookmarklet

1. Show your browser's bookmarks bar.
2. Create a new bookmark (right-click the bar → _Add page_ / _New bookmark_).
3. Name it **Autofill** (or `Padrón autofill`).
4. Paste the entire `javascript:…` line as the bookmark's **URL**.
5. Save.

Re-run `npm run autofill` and reinstall whenever your profile changes.

### 3. Use it

1. Open the booking form (use the **→ Abrir formulario** button in the alert).
2. Wait for the form to fully load.
3. Click the **Autofill** bookmark — the seven fields fill in.
4. **Solve the captcha and press _Acceptar_ yourself.**

> Prefer not to install a bookmark? Open DevTools → Console, paste the readable
> snippet from `npm run autofill`, and press Enter — it does the same thing.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test
```
