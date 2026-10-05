// Общий модуль нейропродавца салона «Ангелина».
// Секреты задаются в Supabase → Edge Functions → Secrets (в коде их нет):
//   YANDEX_API_KEY, YANDEX_FOLDER_ID   — ключ API и каталог Yandex Cloud
//   YANDEX_MODEL                       — необязательно, по умолчанию yandexgpt-lite/latest
//   TELEGRAM_TOKEN                     — токен бота от @BotFather
//   TELEGRAM_ADMIN_CHAT_ID             — чат администратора для уведомлений о заявках
//   TELEGRAM_WEBHOOK_SECRET            — любая длинная случайная строка (защита вебхука)
//   ALLOWED_ORIGINS                    — необязательно, адреса сайта через запятую
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import { createClient } from "npm:@supabase/supabase-js@2";

export const env = (k: string, d = "") => Deno.env.get(k) ?? d;

export const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

export const SERVICES = [
  "Женская стрижка", "Мужская стрижка", "Маникюр", "Педикюр", "Брови и ресницы",
  "Уход за лицом", "Эстетика тела", "Эпиляция", "Массаж", "Солярий",
  "Татуировка", "Пирсинг", "Несколько услуг",
];

export const CONTACT_PHONE = "+7 (916) 163-41-46";
export const ADMIN_URL = env("ADMIN_URL", "https://aperevedencev-glitch.github.io/angelina/admin/");

// ---------- сведения о салоне для нейропродавца ----------
const SALON_FACTS = `
Салон красоты «Ангелина», работает 20 лет.
Адрес: Московская область, Королёв, микрорайон Болшево, Пушкинская ул., 15.
Телефоны: +7 (916) 163-41-46, +7 (498) 646-99-96, +7 (985) 157-07-76.
Часы работы: ежедневно с 10:00 до 20:00, без выходных.
Услуги: женские стрижки, укладки и окрашивание (в том числе мелирование); мужские стрижки; маникюр и педикюр с покрытием;
брови и ресницы; уход за лицом; эстетика тела; эпиляция для женщин и мужчин; массаж; солярий (выгоднее по абонементу);
татуировка (эскиз согласуем до начала работы, стерильные инструменты и одноразовые расходники); пирсинг (прокол ушей и других зон).
Мастера: Виктор — основатель салона, тату-мастер и мастер пирсинга; Вера — стилист-парикмахер; Светлана — мастер маникюра и педикюра.
Можно записаться на несколько услуг за один визит — администратор подберёт время.
`.trim();

function systemPrompt(channel: "site" | "telegram") {
  const today = new Date().toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  return `Ты — Ангелина, администратор салона красоты «Ангелина». Отвечаешь клиентам ${channel === "site" ? "в чате на сайте" : "в Telegram"}.
Сегодня ${today}.

Факты о салоне (используй только их):
${SALON_FACTS}

Как отвечать:
- Пиши по-русски, тепло и коротко: 1–3 предложения. Обращайся на «вы». Без эмодзи и без markdown.
- Цен у тебя нет: на вопрос о стоимости отвечай, что точную цену назовёт администратор при подтверждении записи, и предлагай записаться.
- Ничего не выдумывай: никаких скидок, акций, свободных окон, сроков, процедур и имён мастеров, которых нет в фактах. Если не знаешь — скажи, что уточнит администратор, и дай телефон ${CONTACT_PHONE}.
- Ты не подтверждаешь запись сама: администратор перезвонит и подтвердит точное время.
- На вопросы не о салоне вежливо отвечай, что помогаешь только с услугами салона.
- Никогда не проси данные карты, паспорта или оплату.

Твоя цель — записать клиента. Мягко веди к записи: узнай услугу, желаемый день или время, имя и номер телефона. Спрашивай по одному-два пункта за раз.
Когда клиент сообщил имя и телефон и согласен на запись, напиши короткое подтверждение («Передала заявку администратору, он перезвонит и подтвердит время») и в самом конце ответа добавь отдельной строкой служебную метку:
[[ЗАЯВКА]]{"name":"имя","phone":"телефон","service":"одна из: ${SERVICES.join(", ")}","date":"день или время со слов клиента","comment":"важные детали"}
Метку добавляй только один раз за разговор и только с реальными данными клиента.`;
}

// ---------- YandexGPT ----------
type Msg = { role: "user" | "assistant"; content: string };

export async function askYandex(channel: "site" | "telegram", history: Msg[]): Promise<string | null> {
  const key = env("YANDEX_API_KEY"), folder = env("YANDEX_FOLDER_ID");
  if (!key || !folder) return null;
  const model = env("YANDEX_MODEL", "yandexgpt-lite/latest");
  const body = {
    modelUri: `gpt://${folder}/${model}`,
    completionOptions: { stream: false, temperature: 0.3, maxTokens: "600" },
    messages: [{ role: "system", text: systemPrompt(channel) }, ...history.map((m) => ({ role: m.role, text: m.content }))],
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Api-Key ${key}`, "x-folder-id": folder },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) { console.log("yandex error", res.status, (await res.text()).slice(0, 500)); return null; }
    const j = await res.json();
    return j?.result?.alternatives?.[0]?.message?.text ?? null;
  } catch (e) {
    console.log("yandex fetch failed", String(e)); return null;
  } finally { clearTimeout(t); }
}

// ---------- метка заявки ----------
export type LeadDraft = { name: string; phone: string; service: string; date: string; comment: string };

export function normalizePhone(raw: string): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d.length >= 11 && d.length <= 15 ? "+" + d : null;
}

export function splitLead(text: string): { reply: string; lead: LeadDraft | null } {
  const m = text.match(/\[\[\s*ЗАЯВКА\s*\]\]\s*(\{[\s\S]*?\})/);
  const reply = text.replace(/\[\[\s*ЗАЯВКА\s*\]\][\s\S]*$/, "").trim();
  if (!m) return { reply, lead: null };
  try {
    const o = JSON.parse(m[1]);
    const phone = normalizePhone(o.phone);
    const name = clean(o.name, 60);
    if (!phone || !name || /^имя$/i.test(name)) return { reply, lead: null };
    const raw = clean(o.service, 60);
    const service = SERVICES.find((x) => x.toLowerCase() === raw.toLowerCase()) ?? (raw || "Не указана");
    return { reply, lead: { name, phone, service, date: clean(o.date, 80), comment: clean(o.comment, 300) } };
  } catch { return { reply, lead: null }; }
}

export const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- база ----------
export async function getConversation(channel: "site" | "telegram", externalId: string, name?: string, username?: string) {
  const { data, error } = await db.from("salon_conversations")
    .upsert({ channel, external_id: externalId, last_message_at: new Date().toISOString(),
              ...(name ? { client_name: name } : {}), ...(username ? { client_username: username } : {}) },
            { onConflict: "channel,external_id" })
    .select("id, client_name, client_username").single();
  if (error) throw error;
  return data;
}

export async function history(conversationId: string, limit = 16): Promise<Msg[]> {
  const { data } = await db.from("salon_messages").select("role, content")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).reverse() as Msg[];
}

export async function saveMessage(conversationId: string, role: "user" | "assistant", content: string) {
  await db.from("salon_messages").insert({ conversation_id: conversationId, role, content: content.slice(0, 4000) });
}

export async function recentUserMessages(conversationId: string, minutes: number) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count } = await db.from("salon_messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId).eq("role", "user").gte("created_at", since);
  return count ?? 0;
}

export async function repliesToday() {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { count } = await db.from("salon_messages").select("id", { count: "exact", head: true })
    .eq("role", "assistant").gte("created_at", since);
  return count ?? 0;
}

export async function createLead(source: "site_form" | "site_chat" | "telegram", lead: LeadDraft, conversationId?: string, extra?: { username?: string; tgUserId?: number }) {
  if (conversationId) {
    const since = new Date(Date.now() - 6 * 3600000).toISOString();
    const { count } = await db.from("salon_leads").select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId).gte("created_at", since);
    if ((count ?? 0) > 0) return null;   // заявка из этого диалога уже есть
  }
  const { data, error } = await db.from("salon_leads").insert({
    source, name: lead.name, phone: lead.phone, service: lead.service,
    desired_date: lead.date || null, comment: lead.comment || null, conversation_id: conversationId ?? null,
  }).select("id").single();
  if (error) throw error;
  await notifyAdmin(data.id, source, lead, extra);
  return data.id as number;
}

// ---------- Telegram ----------
export async function tg(method: string, payload: Record<string, unknown>) {
  const token = env("TELEGRAM_TOKEN");
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!res.ok) console.log("telegram error", method, res.status, (await res.text()).slice(0, 300));
  return res.ok;
}

const SOURCE_LABEL = { site_form: "форма на сайте", site_chat: "чат на сайте", telegram: "Telegram" };

export async function notifyAdmin(id: number, source: keyof typeof SOURCE_LABEL, l: LeadDraft, extra?: { username?: string; tgUserId?: number }) {
  const chat = env("TELEGRAM_ADMIN_CHAT_ID");
  if (!chat) return;
  const tgLine = extra?.username ? `Telegram: @${esc(extra.username)}`
    : extra?.tgUserId ? `Telegram: <a href="tg://user?id=${extra.tgUserId}">написать клиенту</a>` : null;
  const lines = [
    `<b>Новая заявка №${id}</b> · ${SOURCE_LABEL[source]}`,
    "",
    `Имя: ${esc(l.name)}`,
    `Телефон: ${esc(l.phone)}`,
    `Услуга: ${esc(l.service)}`,
    l.date ? `Когда: ${esc(l.date)}` : null,
    l.comment ? `Комментарий: ${esc(l.comment)}` : null,
    tgLine,
    "",
    `<a href="${ADMIN_URL}">Открыть CRM</a>`,
  ].filter((x) => x !== null);
  await tg("sendMessage", { chat_id: chat, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true });
}

// ---------- CORS для сайта ----------
export function cors(req: Request) {
  const allowed = env("ALLOWED_ORIGINS", "https://aperevedencev-glitch.github.io").split(",").map((s) => s.trim());
  const origin = req.headers.get("Origin") || "";
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin : allowed[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, apikey, authorization, x-client-info",
      "Vary": "Origin",
    } as Record<string, string>,
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export const FALLBACK = `Сейчас не могу ответить подробно. Позвоните нам: ${CONTACT_PHONE}, ежедневно с 10:00 до 20:00 — или оставьте заявку в форме записи.`;
