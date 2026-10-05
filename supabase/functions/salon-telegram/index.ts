// Telegram-бот салона: нейропродавец отвечает клиентам и передаёт заявки в CRM.
// Вебхук защищён секретом TELEGRAM_WEBHOOK_SECRET (заголовок X-Telegram-Bot-Api-Secret-Token).
import {
  askYandex, clean, createLead, env, FALLBACK, getConversation, history, recentUserMessages,
  repliesToday, saveMessage, splitLead, tg,
} from "../_shared/salon.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const GREETING = "Здравствуйте! Я Ангелина, администратор салона красоты «Ангелина» в Болшево. " +
  "Подскажу по услугам и запишу вас к мастеру. Что вас интересует?";

const contactKeyboard = {
  keyboard: [[{ text: "Отправить номер телефона", request_contact: true }]],
  resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: "Напишите вопрос",
};

// deno-lint-ignore no-explicit-any
async function handle(msg: any) {
  const chatId = msg.chat.id;
  const text0: string = msg.text ?? "";

  if (text0.startsWith("/id")) {
    await tg("sendMessage", { chat_id: chatId, text: `chat_id этого чата: ${chatId}` });
    return;
  }
  if (String(chatId) === env("TELEGRAM_ADMIN_CHAT_ID")) return;   // рабочий чат — без нейропродавца
  if (msg.chat.type !== "private") return;

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
  const conv = await getConversation("telegram", String(chatId), clean(name, 60) || undefined, msg.from?.username);

  if (text0.startsWith("/start")) {
    await saveMessage(conv.id, "assistant", GREETING);
    await tg("sendMessage", { chat_id: chatId, text: GREETING, reply_markup: contactKeyboard });
    return;
  }

  const text = msg.contact?.phone_number ? `Мой номер телефона: ${msg.contact.phone_number}` : clean(text0, 1000);
  if (!text) {
    await tg("sendMessage", { chat_id: chatId, text: "Пока я понимаю только текстовые сообщения. Напишите, пожалуйста, ваш вопрос." });
    return;
  }
  if (await recentUserMessages(conv.id, 60) >= 30) {
    await tg("sendMessage", { chat_id: chatId, text: "Сообщений слишком много подряд. Позвоните нам: +7 (916) 163-41-46." });
    return;
  }

  await saveMessage(conv.id, "user", text);
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });

  const limit = Number(env("SALON_DAILY_LIMIT", "800"));
  const raw = (await repliesToday()) < limit ? await askYandex("telegram", await history(conv.id)) : null;
  if (!raw) {
    await saveMessage(conv.id, "assistant", FALLBACK);
    await tg("sendMessage", { chat_id: chatId, text: FALLBACK });
    return;
  }

  const { reply, lead } = splitLead(raw);
  const answer = reply || "Передала заявку администратору — он перезвонит и подтвердит время.";
  await saveMessage(conv.id, "assistant", answer);
  await tg("sendMessage", { chat_id: chatId, text: answer, ...(lead ? { reply_markup: { remove_keyboard: true } } : {}) });

  if (lead) await createLead("telegram", lead, conv.id, { username: msg.from?.username, tgUserId: msg.from?.id });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = env("TELEGRAM_WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (msg?.chat?.id) {
    // отвечаем Telegram сразу, а сам ответ клиенту готовим в фоне — так бот не получает повторов
    EdgeRuntime.waitUntil(handle(msg).catch((e) => console.log("salon-telegram error", e)));
  }
  return new Response("ok");
});
