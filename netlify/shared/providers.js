// Sun'iy intellekt provayderlari: Gemini (Google), Claude (Anthropic) yoki Groq.
// Tanlash: DT_PROVIDER = gemini | anthropic | groq. Berilmasa — qaysi kalit bor bo'lsa o'sha (tartib: Gemini, Groq, Claude).
// ZAXIRA: asosiy provayder xato bersa (429, 5xx, bo'sh javob va h.k.), kaliti bor keyingi provayderga avtomatik o'tiladi.
export function pickProvider(env) {
  const want = (env("DT_PROVIDER") || "").toLowerCase();
  const g = env("GEMINI_API_KEY"), a = env("ANTHROPIC_API_KEY"), q = env("GROQ_API_KEY");
  const model = env("DT_MODEL");
  const all = [];
  if (g) all.push({ name: "gemini", key: g.trim(), model: model || "gemini-3.8-flash", modelFixed: Boolean(model && env("DT_MODEL_STRICT")), call: callGemini });
  // Groq modeli alohida GROQ_MODEL o'zgaruvchisidan olinadi (DT_MODEL Gemini/Claude nomi bo'lishi mumkin)
  if (q) all.push({ name: "groq", key: q.trim(), model: env("GROQ_MODEL") || GROQ_DEFAULT_MODEL, call: callGroq });
  if (a) all.push({ name: "anthropic", key: a.trim(), model: model || "claude-sonnet-5-5", call: callAnthropic });
  if (!all.length) return null;
  // DT_PROVIDER ko'rsatilgan va uning kaliti bor bo'lsa — u birinchi, qolganlari zaxira
  let chain = all;
  const first = all.find((x) => x.name === want);
  if (first) chain = [first, ...all.filter((x) => x !== first)];
  const primary = chain[0];
  return { ...primary, chain, call: callChain };
}

// Zanjir bo'ylab ketma-ket urinadi; hammasi yiqilsa — birinchi (asosiy) provayderning xatosini qaytaradi.
async function callChain(p, prompt, image) {
  let firstErr = null;
  const notes = [];
  for (const q of p.chain) {
    try {
      const out = await q.call(q, prompt, image);
      if (firstErr) console.log("zaxira ishladi:", q.name, "(asosiy xato:", firstErr.code, ")");
      return out;
    } catch (e) {
      console.log(q.name + " yiqildi:", e && e.code, String((e && (e.detail || e.message)) || "").slice(0, 200));
      if (!firstErr) firstErr = e instanceof ProviderError ? e : new ProviderError("upstream_error", String((e && e.message) || e));
      notes.push(q.name + ": " + String((e && (e.detail || e.code)) || "").replace(/\s+/g, " ").slice(0, 80));
    }
  }
  throw new ProviderError(firstErr.code, notes.join(" | "));
}

export class ProviderError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }

async function post(url, headers, body) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
  catch (_) { throw new ProviderError("upstream_error", "tarmoq xatosi"); }
  if (r.status === 429) throw new ProviderError("rate_limited", "429");
  if (!r.ok) { const t = (await r.text()).slice(0, 400); throw new ProviderError(r.status === 400 ? "refused" : "upstream_error", r.status + " " + t); }
  return r.json();
}

// image: {mime, data(base64)} | null
// Google AI Studio kaliti (AIza...) — generativelanguage.googleapis.com;
// Vertex AI express kaliti (ko'pincha AQ. bilan boshlanadi) — aiplatform.googleapis.com. Ikkalasi ham sinab ko'riladi.
export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3-flash", "gemini-flash-latest", "gemini-2.5-flash"];
export const GEMINI_HOSTS = {
  studio: (m) => "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(m) + ":generateContent",
  vertex: (m) => "https://aiplatform.googleapis.com/v1/publishers/google/models/" + encodeURIComponent(m) + ":generateContent",
};
let working = null; // birinchi muvaffaqiyatli {host, model} shu nusxada eslab qolinadi

async function callGemini(p, prompt, image) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  parts.push({ text: prompt });
  const body = { contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 8192 } };
  const hosts = ["studio", "vertex"]; // Studio birinchi: diag natijasida AQ. kalit ham shu yerda ishlagan; Vertex ko'pincha 403 beradi
  const models = p.modelFixed ? [p.model] : GEMINI_MODELS;
  const tries = [];
  if (working) tries.push(working);
  for (const h of hosts) for (const m of models) if (!working || working.host !== h || working.model !== m) tries.push({ host: h, model: m });
  let j = null, firstErr = null;
  const deadHosts = new Set(); // 401/403 bergan manzil qolgan modellar bilan qayta sinalmaydi
  const errs = [];             // har bir urinish natijasi (xato tafsiloti uchun)
  let sawBusy = false;
  for (let round = 0; round < 2 && !j; round++) {
    if (round) await new Promise((r) => setTimeout(r, 2000)); // band bo'lsa, 2 soniya kutib qayta urinamiz
    let anyBusy = false;
    for (const t of tries.slice(0, 8)) {
      if (deadHosts.has(t.host)) continue;
      try { j = await post(GEMINI_HOSTS[t.host](t.model), { "x-goog-api-key": p.key }, body); working = t; break; }
      catch (e) {
        if (e.code === "rate_limited") throw e;
        if (!firstErr) firstErr = e;
        const d = String(e.detail || e.code || "");
        if (/^5\d\d\b/.test(d)) { anyBusy = true; sawBusy = true; }
        if (/^40[13]\b/.test(d)) { deadHosts.add(t.host); working = working && working.host === t.host ? null : working; }
        errs.push(t.model + ": " + d.replace(/\s+/g, " ").slice(0, 70));
        console.log("gemini urinish:", t.host, t.model, d.slice(0, 200));
      }
    }
    if (j || !anyBusy) break;
  }
  if (!j) { working = null; throw new ProviderError(sawBusy ? "busy" : (firstErr ? firstErr.code : "upstream_error"), errs.slice(-3).join(" | ")); }
  if (j.promptFeedback && j.promptFeedback.blockReason) throw new ProviderError("refused", j.promptFeedback.blockReason);
  const c = (j.candidates || [])[0];
  const text = ((c && c.content && c.content.parts) || []).filter((x) => !x.thought && typeof x.text === "string").map((x) => x.text).join("");
  if (!text) throw new ProviderError(c && c.finishReason === "SAFETY" ? "refused" : "empty_completion", c ? c.finishReason : "no candidate");
  return text;
}

async function callAnthropic(p, prompt, image) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
  content.push({ type: "text", text: prompt });
  const j = await post("https://api.anthropic.com/v1/messages", { "x-api-key": p.key, "anthropic-version": "2023-06-01" },
    { model: p.model, max_tokens: 2500, messages: [{ role: "user", content }] });
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new ProviderError("empty_completion", "bo'sh javob");
  return text;
}

// Groq (OpenAI-mos API). Rasm uchun vision modeli kerak — hozirgi: Qwen 3.8 27B (console.groq.com/docs/vision).
// Model nomi o'zgarsa, kodni tahrirlamasdan Netlify'da GROQ_MODEL o'zgaruvchisi bilan almashtirish mumkin.
const GROQ_DEFAULT_MODEL = "qwen/qwen3.8-27b";
async function callGroq(p, prompt, image) {
  const content = [{ type: "text", text: prompt }];
  if (image) content.push({ type: "image_url", image_url: { url: "data:" + image.mime + ";base64," + image.data } });
  const base = { model: p.model, messages: [{ role: "user", content }], temperature: 0.1, max_completion_tokens: 8192 };
  const hdr = { authorization: "Bearer " + p.key };
  const url = "https://api.groq.com/openai/v1/chat/completions";
  let j;
  try { j = await post(url, hdr, { ...base, response_format: { type: "json_object" } }); }       // JSON rejimi (toza JSON)
  catch (e) { if (e.code !== "refused") throw e; j = await post(url, hdr, base); }                 // 400 bo'lsa, JSON rejimisiz qayta
  const c = (j.choices || [])[0];
  let text = c && c.message && typeof c.message.content === "string" ? c.message.content : "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); // "o'ylash" bloki bo'lsa, olib tashlaymiz
  if (!text) throw new ProviderError("empty_completion", c ? String(c.finish_reason) : "no choice");
  return text;
}
