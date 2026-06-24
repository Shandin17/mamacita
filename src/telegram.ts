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

// PRD §3.2/FR2: send the alert via the Telegram Bot API.
export async function sendTelegramAlert(
  config: TelegramConfig,
  hit: Hit,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const message = buildAlertMessage(hit, config.chatId);
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
