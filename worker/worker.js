// 핏노트 AI 서버 (Cloudflare Worker)
// - Anthropic API 열쇠는 Cloudflare의 비밀 값(ANTHROPIC_API_KEY)에만 있어요. 앱 코드에는 없어요.
// - 베타 코드(BETA_CODE)가 맞는 요청만 받아요.
// - 핏노트 주소에서 온 요청만 받고, 한 사람(IP)당 1시간 요청 수를 제한해요.
// - 회원 메모는 저장하지 않고 AI에 전달만 해요.

const ALLOWED_ORIGINS = ["https://woosgi.github.io"];
const MODEL = "claude-haiku-5-5";
const MAX_PROMPT = 12000;      // 글자 수 상한
const PER_HOUR = 60;           // IP당 1시간 요청 수
const hits = new Map();

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const reply = (body, status, origin) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (req.method !== "POST") return reply({ error: "POST only" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: "forbidden" }, 403, origin);

    let body;
    try { body = await req.json(); } catch { return reply({ error: "bad json" }, 400, origin); }
    if (!env.BETA_CODE || body.code !== env.BETA_CODE) return reply({ error: "bad code" }, 401, origin);
    const prompt = String(body.prompt || "");
    if (!prompt || prompt.length > MAX_PROMPT) return reply({ error: "bad prompt" }, 400, origin);

    // 간단한 사용량 제한
    const ip = req.headers.get("CF-Connecting-IP") || "?";
    const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
    if (list.length >= PER_HOUR) return reply({ error: "slow down" }, 429, origin);
    list.push(now); hits.set(ip, list);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: "You are a writing helper inside a Korean personal-trainer journal app. Follow the user's instructions exactly and reply with JSON only, no code fences.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return reply({ error: "ai " + r.status }, 502, origin);
    const data = await r.json();
    const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    return reply({ text }, 200, origin);
  },
};
