// Подключения для CRM: состояние YandexGPT и Telegram, сохранение ключей, привязка чата уведомлений.
// Доступ только у вошедшего администратора салона (почта в salon_admins).
import {
  cfg, cors, db, delSetting, json, setSetting, settings, tgCall, WEBHOOK_URL, yandexComplete,
} from "../_shared/salon.ts";

const rnd = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

async function status() {
  const s = await settings(true);
  const token = await cfg("telegram_token");
  const out: Record<string, unknown> = {
    yandex: {
      configured: Boolean((await cfg("yandex_api_key")) && (await cfg("yandex_folder_id"))),
      folder: await cfg("yandex_folder_id"),
      model: (await cfg("yandex_model")) || "yandexgpt-lite/latest",
      checked_at: s.yandex_checked_at || null,
    },
    telegram: { configured: Boolean(token), bot: null, webhook: null },
    notify: { linked: Boolean(await cfg("notify_chat_id")), chat: null },
  };
  if (token) {
    const me = await tgCall("getMe");
    const tgOut = out.telegram as Record<string, unknown>;
    if (me.ok) {
      tgOut.bot = { username: me.result.username, name: me.result.first_name };
      if (s.bot_username !== me.result.username) await setSetting("bot_username", me.result.username);
    } else tgOut.error = "Telegram не принял токен: " + (me.description || "ошибка");
    const wh = await tgCall("getWebhookInfo");
    if (wh.ok) tgOut.webhook = { connected: wh.result.url === WEBHOOK_URL, pending: wh.result.pending_update_count, last_error: wh.result.last_error_message || null };
    const chat = await cfg("notify_chat_id");
    if (chat) {
      const c = await tgCall("getChat", { chat_id: chat });
      (out.notify as Record<string, unknown>).chat = c.ok ? (c.result.title || [c.result.first_name, c.result.last_name].filter(Boolean).join(" ") || c.result.username) : null;
    }
  }
  const [{ count: leads }, { count: site }, { count: tgc }] = await Promise.all([
    db.from("salon_leads").select("id", { count: "exact", head: true }),
    db.from("salon_conversations").select("id", { count: "exact", head: true }).eq("channel", "site"),
    db.from("salon_conversations").select("id", { count: "exact", head: true }).eq("channel", "telegram"),
  ]);
  out.counts = { leads, site_chats: site, telegram_chats: tgc };
  return out;
}

async function connectTelegram(token: string) {
  token = token.trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, error: "Это не похоже на токен бота. Он выглядит так: 123456789:AAH…, его выдаёт @BotFather." };
  const me = await tgCall("getMe", {}, token);
  if (!me.ok) return { ok: false, error: "Telegram не принял токен. Проверьте, что скопировали его целиком." };
  const secret = (await cfg("webhook_secret")) || rnd(24);
  const wh = await tgCall("setWebhook", { url: WEBHOOK_URL, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }, token);
  if (!wh.ok) return { ok: false, error: "Не удалось подключить бота к серверу: " + (wh.description || "ошибка") };
  await setSetting("telegram_token", token);
  await setSetting("webhook_secret", secret);
  await setSetting("bot_username", me.result.username);
  await tgCall("setMyCommands", { commands: [{ command: "start", description: "Начать разговор с администратором" }] }, token);
  return { ok: true, username: me.result.username };
}

async function saveYandex(apiKey: string, folder: string, model: string) {
  apiKey = apiKey.trim(); folder = folder.trim(); model = (model || "yandexgpt-lite/latest").trim();
  if (!apiKey || !folder) return { ok: false, error: "Нужны и API-ключ, и идентификатор каталога." };
  const r = await yandexComplete(apiKey, folder, model, [
    { role: "system", text: "Отвечай одним словом." }, { role: "user", text: "Скажи «работает»." },
  ]);
  if (!r.ok) {
    const why = r.status === 401 ? "ключ не подошёл" : r.status === 403 ? "у сервисного аккаунта нет роли ai.languageModels.user или неверный каталог"
      : r.status === 404 ? "модель или каталог не найдены" : r.status === 429 ? "превышен лимит запросов" : (r.error || "ошибка");
    return { ok: false, error: "YandexGPT не ответил: " + why + "." };
  }
  await setSetting("yandex_api_key", apiKey);
  await setSetting("yandex_folder_id", folder);
  await setSetting("yandex_model", model);
  await setSetting("yandex_checked_at", new Date().toISOString());
  return { ok: true, answer: r.text };
}

Deno.serve(async (req) => {
  const c = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "Только POST" }, c.headers);
  if (!c.ok) return json(403, { ok: false, error: "Чужой сайт" }, c.headers);

  // кто спрашивает: проверяем вход администратора сами
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(jwt);
  const email = u?.user?.email;
  if (!email) return json(401, { ok: false, error: "Войдите в CRM заново." }, c.headers);
  const { data: adm } = await db.from("salon_admins").select("email").eq("email", email).maybeSingle();
  if (!adm) return json(403, { ok: false, error: "Нет доступа." }, c.headers);

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Неверный формат" }, c.headers); }

  try {
    switch (b.action) {
      case "status": return json(200, { ok: true, ...(await status()) }, c.headers);
      case "save_telegram": return json(200, await connectTelegram(String(b.token || "")), c.headers);
      case "save_yandex": return json(200, await saveYandex(String(b.api_key || ""), String(b.folder_id || ""), String(b.model || "")), c.headers);
      case "link_code": {
        const username = await cfg("bot_username");
        if (!username) return json(200, { ok: false, error: "Сначала подключите Telegram-бота." }, c.headers);
        const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        await setSetting("link_code", code);
        await setSetting("link_code_exp", String(Date.now() + 15 * 60000));
        return json(200, { ok: true, code, username }, c.headers);
      }
      case "test_notify": {
        const chat = await cfg("notify_chat_id");
        if (!chat) return json(200, { ok: false, error: "Чат для уведомлений ещё не привязан." }, c.headers);
        const r = await tgCall("sendMessage", { chat_id: chat, text: "Проверка из CRM: уведомления о заявках салона «Ангелина» работают." });
        return json(200, r.ok ? { ok: true } : { ok: false, error: "Не отправилось: " + (r.description || "ошибка") }, c.headers);
      }
      case "unlink_notify": { await delSetting("notify_chat_id"); return json(200, { ok: true }, c.headers); }
      default: return json(400, { ok: false, error: "Неизвестное действие" }, c.headers);
    }
  } catch (e) {
    console.log("salon-admin error", e);
    return json(500, { ok: false, error: "Ошибка сервера." }, c.headers);
  }
});

