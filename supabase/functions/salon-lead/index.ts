// Заявка из формы записи на сайте → CRM + уведомление администратору в Telegram.
import { clean, cors, createLead, json, normalizePhone, SERVICES } from "../_shared/salon.ts";

Deno.serve(async (req) => {
  const c = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "Только POST" }, c.headers);
  if (!c.ok) return json(403, { ok: false, error: "Чужой сайт" }, c.headers);

  let d: Record<string, unknown>;
  try { d = await req.json(); } catch { return json(400, { ok: false, error: "Неверный формат заявки" }, c.headers); }

  if (d.website) return json(200, { ok: true }, c.headers);          // ловушка для ботов

  const name = clean(d.name, 60);
  const phone = normalizePhone(String(d.phone ?? ""));
  const service = SERVICES.includes(String(d.service)) ? String(d.service) : "Не указана";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date ?? "")) ? String(d.date).split("-").reverse().join(".") : "";

  if (!name) return json(422, { ok: false, error: "Укажите имя." }, c.headers);
  if (!phone) return json(422, { ok: false, error: "Проверьте номер телефона." }, c.headers);
  if (d.agree !== true) return json(422, { ok: false, error: "Нужно согласие на обработку данных." }, c.headers);

  try {
    await createLead("site_form", { name, phone, service, date, comment: "" });
    return json(200, { ok: true }, c.headers);
  } catch (e) {
    console.log("salon-lead error", e);
    return json(502, { ok: false, error: "Не удалось сохранить заявку." }, c.headers);
  }
});
