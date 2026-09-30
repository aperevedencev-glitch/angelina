// Cloudflare Worker: принимает заявку с сайта «Ангелины» и пересылает её в Telegram.
// Секреты (задаются через `wrangler secret put`, в коде их нет):
//   TELEGRAM_TOKEN   — токен бота от @BotFather
//   TELEGRAM_CHAT_ID — chat_id администратора или рабочего чата
// Переменная в wrangler.toml:
//   ALLOWED_ORIGIN   — адрес сайта, например https://aperevedencev-glitch.github.io

const SERVICES = [
  "Женская стрижка", "Мужская стрижка", "Маникюр", "Педикюр", "Эпиляция",
  "Массаж", "Солярий", "Татуировка", "Пирсинг", "Несколько услуг",
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(405, { ok: false, error: "Только POST" });
    if (allowed && origin !== allowed) return reply(403, { ok: false, error: "Чужой сайт" });

    let data;
    try {
      data = await request.json();
    } catch {
      return reply(400, { ok: false, error: "Неверный формат заявки" });
    }

    // Ловушка для ботов: скрытое поле, которое человек не заполняет.
    if (data.website) return reply(200, { ok: true });

    const name = clean(data.name, 60);
    let phoneDigits = String(data.phone || "").replace(/\D/g, "");
    if (phoneDigits.length === 11 && phoneDigits[0] === "8") phoneDigits = "7" + phoneDigits.slice(1);
    if (phoneDigits.length === 10) phoneDigits = "7" + phoneDigits;
    const service = SERVICES.includes(data.service) ? data.service : "Не указана";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || "") ? formatDate(data.date) : "не выбрана";

    if (!name) return reply(422, { ok: false, error: "Укажите имя" });
    if (phoneDigits.length < 10 || phoneDigits.length > 15)
      return reply(422, { ok: false, error: "Проверьте номер телефона" });
    if (data.agree !== true) return reply(422, { ok: false, error: "Нужно согласие на обработку данных" });

    const text = [
      "<b>Новая заявка с сайта</b>",
      "",
      `Имя: ${esc(name)}`,
      `Телефон: +${phoneDigits}`,
      `Услуга: ${esc(service)}`,
      `Дата: ${date}`,
    ].join("\n");

    const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });

    if (!tg.ok) {
      console.log("Telegram error", tg.status, await tg.text());
      return reply(502, { ok: false, error: "Не удалось передать заявку. Позвоните нам, пожалуйста." });
    }
    return reply(200, { ok: true });
  },
};

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
