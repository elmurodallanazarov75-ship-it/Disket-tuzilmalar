// GET /api/health — sahifa rasm tanish tugmalarini ko‘rsatish-ko‘rsatmaslikni shu yerdan biladi.
import { pickProvider } from "../shared/providers.js";
export default async () => {
  const p = pickProvider((k) => Netlify.env.get(k));
  return Response.json({ ok: true, recognize: Boolean(p), provider: p ? p.name : null }, { headers: { "cache-control": "no-store" } });
};
export const config = { path: "/api/health" };
