import { test } from "node:test";
import assert from "node:assert/strict";
import { deepLink, buildAlertMessage, sendTelegramAlert } from "../src/telegram.ts";
import type { Hit } from "../src/types.ts";

const hit: Hit = {
  servicio: 16,
  centro: 5,
  servicioName: "PADRON CP - Juntas Municipales",
  centroName: "Junta de Distrito Transits",
  raw: { dias: ["2026-06-27"] },
  detectedAt: "2026-06-24T10:43:07.000Z",
};

test("deepLink targets the SPA newAppointment route", () => {
  assert.equal(
    deepLink(16),
    "https://www.valencia.es/QSIGE/apps/citaprevia/index.html?idioma=VA#!/newAppointment/16",
  );
});

test("alert message body includes service, center and timestamp", () => {
  const msg = buildAlertMessage(hit, "CHAT");
  assert.equal(msg.chat_id, "CHAT");
  assert.match(msg.text, /PADRON CP - Juntas Municipales/);
  assert.match(msg.text, /Junta de Distrito Transits/);
  assert.match(msg.text, /2026-06-24T10:43:07.000Z/);
});

test("alert sets disable_web_page_preview and an inline URL button", () => {
  const msg = buildAlertMessage(hit, "CHAT");
  assert.equal(msg.disable_web_page_preview, true);
  const button = msg.reply_markup.inline_keyboard[0][0];
  assert.equal(button.url, deepLink(16));
  assert.ok(button.text.length > 0);
});

test("sendTelegramAlert POSTs to the bot sendMessage endpoint", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  await sendTelegramAlert(
    { botToken: "BOT123", chatId: "CHAT" },
    hit,
    fakeFetch,
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.telegram.org/botBOT123/sendMessage",
  );
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.chat_id, "CHAT");
  assert.equal(body.disable_web_page_preview, true);
  assert.equal(
    body.reply_markup.inline_keyboard[0][0].url,
    deepLink(16),
  );
});

test("sendTelegramAlert throws when Telegram returns ok:false", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: "bad token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    sendTelegramAlert({ botToken: "X", chatId: "CHAT" }, hit, fakeFetch),
    /bad token/,
  );
});
