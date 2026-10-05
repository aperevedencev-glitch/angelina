// Чат нейропродавца на сайте: принимает сообщение, отвечает через YandexGPT, создаёт заявку в CRM.
import {
  askYandex, cfg, clean, cors, createLead, db, env, FALLBACK, getConversation, history, json,
  recentUserMessages, repliesToday, saveMessage, splitLead,
} from "../_shared/salon.ts";

Deno.serve(async (req) => {
  const c = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "Только POST" }, c.headers);
  if (!c.ok) return json(403, { ok: false, error: "Чужой сайт" }, c.headers);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Неверный формат" }, c.headers); }

  // сайт узнаёт адрес Telegram-бота, чтобы показать ссылку на него
  if (b.info === true) return json(200, { ok: true, telegram: (await cfg("bot_username")) || null }, c.headers);

  const sid = String(b.session_id ?? "");
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(sid)) return json(400, { ok: false, error: "Нет сессии" }, c.headers);

  // восстановление переписки после перезагрузки страницы
  if (b.history === true) {
    const { data: conv } = await db.from("salon_conversations").select("id")
      .eq("channel", "site").eq("external_id", sid).maybeSingle();
    if (!conv) return json(200, { ok: true, messages: [] }, c.headers);
    return json(200, { ok: true, messages: await history(conv.id, 30) }, c.headers);
  }

  const text = clean(b.message, 1000);
  if (!text) return json(400, { ok: false, error: "Пустое сообщение" }, c.headers);

  try {
    const conv = await getConversation("site", sid);
    if (await recentUserMessages(conv.id, 60) >= 30) {
      return json(429, { ok: true, reply: "Сообщений слишком много подряд. Позвоните нам: +7 (916) 163-41-46." }, c.headers);
    }
    await saveMessage(conv.id, "user", text);

    const limit = Number(env("SALON_DAILY_LIMIT", "800"));
    const raw = (await repliesToday()) < limit ? await askYandex("site", await history(conv.id)) : null;
    if (!raw) {
      await saveMessage(conv.id, "assistant", FALLBACK);
      return json(200, { ok: true, reply: FALLBACK, fallback: true }, c.headers);
    }

    const { reply, lead } = splitLead(raw);
    const answer = reply || "Передала заявку администратору — он перезвонит и подтвердит время.";
    await saveMessage(conv.id, "assistant", answer);

    let leadId: number | null = null;
    if (lead) {
      leadId = await createLead("site_chat", lead, conv.id);
      if (!conv.client_name) await db.from("salon_conversations").update({ client_name: lead.name }).eq("id", conv.id);
    }
    return json(200, { ok: true, reply: answer, lead: Boolean(leadId) }, c.headers);
  } catch (e) {
    console.log("salon-chat error", e);
    return json(500, { ok: false, reply: FALLBACK }, c.headers);
  }
});
