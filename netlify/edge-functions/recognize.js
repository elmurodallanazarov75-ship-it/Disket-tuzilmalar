// POST /api/recognize — rasm yoki erkin matndagi masalani platforma sintaksisiga o‘giradi.
// Masalani yechish brauzerdagi engine'larda qoladi; bu funksiya faqat yozuvni o‘qiydi.
// Netlify → Project configuration → Environment variables:
//   GEMINI_API_KEY yoki ANTHROPIC_API_KEY (bittasi majburiy)
//   DT_PROVIDER (ixtiyoriy: gemini | anthropic), DT_MODEL (ixtiyoriy)
//   DT_RATE_PER_HOUR (ixtiyoriy, standart 30 — bir IP uchun, taxminiy cheklov)
import PROMPTS from "../shared/prompts.js";
import { pickProvider } from "../shared/providers.js";

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TOPICS = new Set(["sets", "logic", "equiv", "predicate", "boolean", "comb", "relation", "function", "recurrence", "induction", "graph", "tree", "probability", "other"]);
const MAX_IMAGE_B64 = 7 * 1024 * 1024; // ≈ 5 MB rasm (brauzer 1600 px gacha kichraytiradi)
const hits = new Map(); // taxminiy: har bir edge nusxasida alohida saqlanadi

const err = (code, status = 400) => Response.json({ error: code }, { status });

function rateOk(ip, limit) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= limit) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function parseJson(text) {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("no json");
}

export default async (req, context) => {
  if (req.method !== "POST") return err("invalid_request", 405);
  const prov = pickProvider((k) => Netlify.env.get(k));
  if (!prov) return err("sampling_disabled", 503);
  const limit = Number(Netlify.env.get("DT_RATE_PER_HOUR") || 30);
  if (!rateOk(context.ip || "?", limit)) return err("rate_limited", 429);

  let body;
  try { body = await req.json(); } catch (_) { return err("invalid_request"); }
  const kind = body && body.kind, text = typeof body?.text === "string" ? body.text : "";

  let prompt, image = null;
  if (kind === "image") {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(body.image || "");
    if (!m || !MEDIA.has(m[1]) || m[2].length > MAX_IMAGE_B64) return err("image_rejected");
    image = { mime: m[1], data: m[2] };
    prompt = PROMPTS.image;
  } else if (kind === "text") {
    if (!text.trim()) return err("invalid_request");
    prompt = PROMPTS.text_before + text.slice(0, 6000) + PROMPTS.text_after;
  } else return err("invalid_request");

  let out;
  try { out = await prov.call(prov, prompt, image); }
  catch (e) { console.log(prov.name + " API xatosi:", e.code, e.detail || ""); return err(e.code || "upstream_error", e.code === "rate_limited" ? 429 : 502); }

  let data;
  try { data = parseJson(out); } catch (_) { return err("invalid_json", 502); }

  const problems = (Array.isArray(data?.problems) ? data.problems : []).slice(0, 20).filter((p) => p && typeof p === "object").map((p) => ({
    original: String(p.original ?? "").slice(0, 4000),
    input: String(p.input ?? "").slice(0, 4000),
    topic: TOPICS.has(String(p.topic)) ? String(p.topic) : "other",
    note: String(p.note ?? "").slice(0, 500),
  }));
  return Response.json({ problems, unclear: String(data?.unclear ?? "").slice(0, 500) });
};

export const config = { path: "/api/recognize", method: "POST" };
