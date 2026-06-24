import type { Hit, TelegramConfig } from "./types.ts";

// PRD §3.3/FR3 deep link — the SPA newAppointment route for a service.
export function deepLink(servicio: number): string {
  return `https://www.valencia.es/QSIGE/apps/citaprevia/index.html?idioma=VA#!/newAppointment/${servicio}`;
}

export type InlineButton = { text: string; url: string };

export type TelegramMessage = {
  chat_id: string;
  text: string;
  parse_mode: "HTML";
  disable_web_page_preview: true;
  reply_markup: { inline_keyboard: InlineButton[][] };
};

// PRD §6: message with service name, center name, timestamp + inline URL button.
export function buildAlertMessage(hit: Hit, chatId: string): TelegramMessage {
  const servicio = hit.servicioName ?? `servicio ${hit.servicio}`;
  const centro = hit.centroName ?? `centro ${hit.centro}`;
  const fecha = hit.dates?.length ? hit.dates.join(", ") : "ver en web";

  const lines = [
    "🟢 SLOT — Padrón Valencia",
    `Servicio: ${servicio}`,
    `Centro: ${centro}`,
    ...(hit.direccion ? [`Dirección: ${hit.direccion}`] : []),
    `Fecha: ${fecha}`,
    `Detectado: ${hit.detectedAt}`,
    "",
    // PRD §6/FR3: remind the human of the manual flow — autofill bookmarklet,
    // then solve captcha and press Acceptar by hand (never automated).
    'Recordatorio: abre el formulario, pulsa el bookmarklet "Autofill", resuelve el captcha y pulsa Acceptar.',
  ];

  return {
    chat_id: chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "→ Abrir formulario", url: deepLink(hit.servicio) }],
      ],
    },
  };
}

// Low-level Bot API sendMessage poster, shared by the HIT alert and the plain
// liveness messages (heartbeat / degraded / /status reply).
async function postMessage(
  config: TelegramConfig,
  message: object,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    },
  );

  const body = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !body.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${res.status} ${body.description ?? "unknown error"}`,
    );
  }
}

// PRD §3.2/FR2: send the HIT alert via the Telegram Bot API.
export async function sendTelegramAlert(
  config: TelegramConfig,
  hit: Hit,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await postMessage(config, buildAlertMessage(hit, config.chatId), fetchImpl);
}

// PRD §FR2/§8.2: send a plain HTML text message (heartbeat / degraded-state
// alert / /status reply). No inline buttons; preview disabled like the alert.
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await postMessage(
    config,
    {
      chat_id: config.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    fetchImpl,
  );
}

// PRD §8.2 — a single Telegram update (only the fields the /status poller reads).
export type TelegramUpdate = {
  update_id: number;
  message?: { text?: string; chat?: { id: number | string } };
};

// PRD §8.2 — poll getUpdates for pending commands. `offset` confirms previously
// seen updates so they aren't re-delivered; timeout=0 keeps it non-blocking so
// the poll cycle stays on schedule.
export async function fetchUpdates(
  config: TelegramConfig,
  offset: number,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramUpdate[]> {
  const res = await fetchImpl(
    `https://api.telegram.org/bot${config.botToken}/getUpdates?timeout=0&offset=${offset}`,
  );
  const body = (await res.json()) as {
    ok?: boolean;
    result?: TelegramUpdate[];
    description?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(
      `Telegram getUpdates failed: ${res.status} ${body.description ?? "unknown error"}`,
    );
  }
  return body.result ?? [];
}
