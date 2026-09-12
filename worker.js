// Cloudflare Worker: serves the static site AND powers the AI assistant.
//
// Setup:
//   1. npx wrangler secret put ANTHROPIC_API_KEY   (paste your key, stored encrypted)
//   2. npx wrangler deploy
//
// The widget on the page calls POST /api/chat with { message, history }.

const SYSTEM_PROMPT = `You are the AI assistant embedded on the Lavéra Skin Atelier website
(a non-invasive skincare/aesthetics studio in Riga, Latvia).

FACTS YOU KNOW (use only these — do not invent services, prices, or availability):
- Studio: Lavéra Skin Atelier — natural rejuvenation, non-invasive lifting, care based on
  skin physiology. Philosophy: "beauty doesn't hurt."
- Address: Elizabetes iela 31, 2nd floor, Riga, Latvia.
- Phone / WhatsApp: +371 26 106 324.
- Instagram: @lavera.skin.atelier
- Hours: Monday, Tuesday, Thursday, Friday 10:00–17:30. Closed Wednesday, Saturday, Sunday.
- Services: enzyme therapy (DMK), Myo-Fix (botox alternative), express lifting, rosacea
  correction, face cleansing, BMS biomechanical massage, Meder procedures (Hydra-Fill,
  Arma-Lift), chemical peels, microcurrent therapy, LED therapy, mesotherapy,
  biorevitalization, in-person and online consultations.
- Indicative pricing: consultations from €70, enzyme therapy €85–105, chemical peels from
  €90; services generally range €10–€380+ depending on treatment and area.

RULES:
- Answer only questions about Lavéra Skin Atelier (services, pricing, hours, location,
  booking). For anything else, briefly redirect to what you can help with.
- If you don't know an exact detail (e.g. a specific price not listed above, real-time
  appointment availability), say so and point the visitor to WhatsApp/phone
  +371 26 106 324 or Instagram @lavera.skin.atelier to confirm.
- Never invent medical claims or guarantee results.
- Reply in the same language the visitor used (Latvian, Russian, or English).
- Keep answers short: 2–4 sentences, no markdown headers or bullet walls.`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const message = String(body.message || "").slice(0, 2000).trim();
  if (!message) return json({ error: "Empty message" }, 400);

  // Keep only the last few turns, and cap each turn's length.
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const messages = history
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.text || "").slice(0, 2000)
    }))
    .filter((m) => m.content);
  messages.push({ role: "user", content: message });

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages
      })
    });
  } catch (err) {
    return json({ error: "Could not reach the assistant." }, 502);
  }

  if (!upstream.ok) {
    console.error("Anthropic API error", upstream.status, await upstream.text());
    return json({ error: "Assistant is unavailable right now." }, 502);
  }

  const data = await upstream.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  const reply = textBlock ? textBlock.text : "Sorry, I couldn't generate a reply.";

  return json({ reply });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
