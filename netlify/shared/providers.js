// Sun'iy intellekt provayderlari: Gemini (Google) yoki Claude (Anthropic).
// Tanlash: DT_PROVIDER = gemini | anthropic. Berilmasa — qaysi kalit bor bo'lsa o'sha (avval Gemini).
export function pickProvider(env) {
  const want = (env("DT_PROVIDER") || "").toLowerCase();
  const g = env("GEMINI_API_KEY"), a = env("ANTHROPIC_API_KEY");
  const model = env("DT_MODEL");
  if ((want === "gemini" || (!want && g)) && g) return { name: "gemini", key: g, model: model || "gemini-3.8-flash", call: callGemini };
  if ((want === "anthropic" || (!want && a)) && a) return { name: "anthropic", key: a, model: model || "claude-sonnet-5-5", call: callAnthropic };
  return null;
}

class ProviderError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }

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
async function callGemini(p, prompt, image) {
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  parts.push({ text: prompt });
  const body = { contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 8192 } };
  const m = encodeURIComponent(p.model);
  const studio = () => post("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", { "x-goog-api-key": p.key }, body);
  const vertex = () => post("https://aiplatform.googleapis.com/v1/publishers/google/models/" + m + ":generateContent", { "x-goog-api-key": p.key }, body);
  const order = p.key.startsWith("AQ.") ? [vertex, studio] : [studio, vertex];
  let j, first;
  try { j = await order[0](); }
  catch (e) {
    if (e.code === "rate_limited") throw e;
    first = e;
    try { j = await order[1](); } catch (e2) { throw e2.code === "rate_limited" ? e2 : first; }
  }
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
