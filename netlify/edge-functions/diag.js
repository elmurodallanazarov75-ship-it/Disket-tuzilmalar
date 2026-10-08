// GET /api/diag — Gemini ulanishini tekshiradi: qaysi manzil va model ishlayotganini ko'rsatadi.
// Kalitning o'zi hech qachon chiqarilmaydi. Muammo hal bo'lgach bu faylni o'chirish mumkin.
import { GEMINI_MODELS, GEMINI_HOSTS } from "../shared/providers.js";
let last = 0;
export default async () => {
  const key = (Netlify.env.get("GEMINI_API_KEY") || "").trim();
  if (!key) return Response.json({ key: "yo'q" });
  if (Date.now() - last < 20000) return Response.json({ error: "20 soniyada bir marta" }, { status: 429 });
  last = Date.now();
  const out = { key: { prefix: key.slice(0, 3), length: key.length }, results: [] };
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the word OK." }] }], generationConfig: { maxOutputTokens: 256 } });
  for (const host of ["vertex", "studio"]) for (const model of GEMINI_MODELS) {
    let status = 0, msg = "";
    try {
      const r = await fetch(GEMINI_HOSTS[host](model), { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body });
      status = r.status; const t = await r.text();
      try { const j = JSON.parse(t); msg = j.error ? j.error.status + ": " + String(j.error.message).slice(0, 220) : "OK: " + JSON.stringify(j.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean)).slice(0, 80); } catch (_) { msg = t.slice(0, 220); }
    } catch (e) { msg = "tarmoq: " + String(e).slice(0, 120); }
    out.results.push({ host, model, status, msg });
    if (status === 200) return Response.json(out, { headers: { "cache-control": "no-store" } });
  }
  return Response.json(out, { headers: { "cache-control": "no-store" } });
};
export const config = { path: "/api/diag" };
