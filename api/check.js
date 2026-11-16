/**
 * Vercel serverless status aggregator (same checks as Express /api/status).
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  const moviesRemote = "https://emnex-movies-backend.onrender.com";
  const activity = "https://sevenlm-discord-activity.onrender.com";
  const frontend = "https://7lmmovie.vercel.app";
  const upstreamMovies = "https://api.emnexmovies.cc";
  const upstreamAnime = "https://api.emnexanime.site";

  async function probe(id, url, { timeoutMs = 12_000, okWhen } = {}) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json,text/html,*/*" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* ignore */
      }
      const ok = okWhen ? okWhen(r, json) : r.ok;
      return { id, url, ok, status: r.status, ms: Date.now() - started, detail: ok ? "operational" : `http_${r.status}` };
    } catch (err) {
      clearTimeout(timer);
      return {
        id,
        url,
        ok: false,
        status: 0,
        ms: Date.now() - started,
        detail: err?.name === "AbortError" ? "timeout" : String(err?.message || err),
      };
    }
  }

  const checks = await Promise.all([
    probe("render-movies-backend", `${moviesRemote}/api/health`, {
      timeoutMs: 45_000,
      okWhen: (r, j) => r.ok && j?.ok === true,
    }),
    probe("render-movies-trending", `${moviesRemote}/api/trending?perPage=1`, {
      timeoutMs: 45_000,
      okWhen: (r, j) => r.ok && Array.isArray(j?.items),
    }),
    probe("render-anime-trending", `${moviesRemote}/api/anime/trending?perPage=1&page=1`, {
      timeoutMs: 45_000,
      okWhen: (r, j) => r.ok && (Array.isArray(j?.items) || Array.isArray(j?.results)),
    }),
    probe("upstream-emnex-movies", `${upstreamMovies}/`, { timeoutMs: 20_000 }),
    probe("upstream-emnex-anime", `${upstreamAnime}/`, { timeoutMs: 20_000 }),
    probe("discord-activity", `${activity}/api/health`, {
      timeoutMs: 45_000,
      okWhen: (r, j) => r.ok && j?.ok === true,
    }),
    probe("frontend-7lmmovie", frontend, {
      timeoutMs: 15_000,
      okWhen: (r) => r.status > 0 && r.status < 500,
    }),
  ]);

  const operational = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const allOk = operational === total;
  const anyOk = operational > 0;

  return res.status(200).json({
    ok: allOk,
    state: allOk ? "operational" : anyOk ? "degraded" : "major_outage",
    checkedAt: new Date().toISOString(),
    intervalSec: 60,
    summary: {
      operational,
      total,
      avgMs: Math.round(checks.reduce((a, c) => a + c.ms, 0) / total),
    },
    groups: [
      {
        id: "api",
        title: "7LM Movies API",
        services: ["render-movies-backend", "render-movies-trending", "render-anime-trending"],
      },
      {
        id: "cloud",
        title: "Apps",
        services: ["discord-activity", "frontend-7lmmovie"],
      },
      {
        id: "upstream",
        title: "Upstream providers",
        services: ["upstream-emnex-movies", "upstream-emnex-anime"],
      },
    ],
    meta: {
      "render-movies-backend": { name: "API Health", desc: "emnex-movies-backend /api/health" },
      "render-movies-trending": { name: "Movies Trending", desc: "/api/trending" },
      "render-anime-trending": { name: "Anime Trending", desc: "/api/anime/trending" },
      "discord-activity": { name: "Discord Activity", desc: "sevenlm-discord-activity" },
      "frontend-7lmmovie": { name: "Website", desc: "7lmmovie.vercel.app" },
      "upstream-emnex-movies": { name: "Emnex Movies", desc: upstreamMovies },
      "upstream-emnex-anime": { name: "Emnex Anime", desc: upstreamAnime },
    },
    checks,
  });
}
