// Sun'iy intellekt provayderlari: Gemini (Google) yoki Claude (Anthropic).
// Tanlash: DT_PROVIDER = gemini | anthropic. Berilmasa — qaysi kalit bor bo'lsa o'sha (avval Gemini).
export function pickProvider(env) {
  const want = (env("DT_PROVIDER") || "").toLowerCase();
  const g = env("GEMINI_API_KEY"), a = env("ANTHROPIC_API_KEY");
  const model = env("DT_MODEL");
  if ((want === "gemini" || (!want && g)) && g) return { name: "gemini", key: g.trim(), model: model || "gemini-3.8-flash", modelFixed: Boolean(model && env("DT_MODEL_STRICT")), call: callGemini };
  if ((want === "anthropic" || (!want && a)) && a) return { name: "anthropic", key: a, model: model || "claude-sonnet-5-5", call: callAnthropic };
  return null;
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
  const hosts = p.key.startsWith("AQ.") ? ["vertex", "studio"] : ["studio", "vertex"];
  const models = p.modelFixed ? [p.model] : GEMINI_MODELS;
  const tries = [];
  if (working) tries.push(working);
  for (const h of hosts) for (const m of models) if (!working || working.host !== h || working.model !== m) tries.push({ host: h, model: m });
  let j = null, firstErr = null;
  for (const t of tries.slice(0, 8)) {
    try { j = await post(GEMINI_HOSTS[t.host](t.model), { "x-goog-api-key": p.key }, body); working = t; break; }
    catch (e) {
      if (e.code === "rate_limited") throw e;
      if (!firstErr) firstErr = e;
      console.log("gemini urinish:", t.host, t.model, e.detail || e.code);
    }
  }
  if (!j) throw firstErr || new ProviderError("upstream_error");
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
