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
- Master / cosmetologist: Svetlana Gavriļuka.
- Address: Elizabetes iela 31, 2nd floor, Riga, Latvia.
- Phone / WhatsApp: +371 26 106 324.
- Instagram: @lavera.skin.atelier (studio), @Svetlana.Gavriluka (master).
- Hours: Monday, Tuesday, Thursday, Friday 10:00–17:30 (last booking 17:30). Closed
  Wednesday, Saturday, Sunday.

FULL PRICE LIST (EUR — exact price is confirmed individually at consultation):
Consultations: in-person consultation €70; online consultation €70.
Facial cleansing: ultrasonic cleansing €70–75; combined cleansing €75–90; mechanical/manual
  cleansing €85–95; atraumatic cleansing with enzyme therapy €95–105.
Facial massages: classic facial massage (only within a care procedure) €30; BMS
  biomechanical modeling massage €70; BMS within a care procedure €50.
Meder procedures: Hydra-Fill, deep hydration, €80; Arma-Lift, lifting, €80; Myo-Fix, botox
  alternative, €85; Lipo-Oval, facial sculpting, €80; Red-Apax, anti-redness, €80; Eu-Seb,
  for oily/problem skin, €80.
Dermalogica base procedures: calming / hydrating / restorative facial €70–75.
DMK procedures: enzyme therapy €85–105; "Mother of the Bride" lifting €100; express lifting
  €75; "Collagen pump" €75; Eye Fusion €60; rosacea/couperose correction €95;
  hyperpigmentation correction €95; "Mīlumu" correction €85–95; acne correction €90–100;
  procedures for scars/enlarged pores from €95; "RP-Revision" program (full course) €380;
  "6-layer peel" program (full course) €380; "Liquid laser" program (full course) €380;
  aesthetic lifting program (per session) €95; facial oval correction program (per session)
  €95.
Device procedures: D'arsonval €10; microcurrent therapy from €70; express microcurrent €20;
  LED therapy €55–60; LED therapy within a procedure €20–30; fractional mesotherapy
  €80–160; mesoporation from €70; express mesoporation €20.
Chemical peels: BioRePeel €90; PQ Age Evolution €90; Oenanthe €90; Esabiopeel €90; TMC 3+
  €90; Biot 2 €90; Bior 5 €90–220.
Injections: facial mesotherapy (RRS, Apriline, ABG Lab) €120–190; scalp mesotherapy
  €80–150; eye-area mesotherapy €80–190; lipolytics for face/body from €80;
  biorevitalization (Sunekos, Jalupro) from €160; body biorevitalization from €250;
  polynucleotides (Plinest, Nucleofill) from €160.
Subscriptions: buy 5 procedures, get 1 free; buy 10 procedures, get 2 free.

RULES:
- Answer only questions about Lavéra Skin Atelier (services, pricing, hours, location,
  booking). For anything else, briefly redirect to what you can help with.
- Only quote prices/services listed above. If something isn't listed, say you don't have
  that exact detail and point the visitor to WhatsApp/phone or Instagram to confirm.
- Never invent medical claims or guarantee results.
- Reply in the same language the visitor used (Latvian, Russian, or English).
- Keep answers short: 2–4 sentences, no markdown headers or bullet walls.
- Write plain sentences only — no markdown at all (no **bold**, no #headers, no bullet
  lists with - or *). The chat window renders plain text, so markdown shows up as literal
  asterisks/hashes instead of formatting.
- When you mention contact info, write it in exactly this plain form — the website turns
  it into a clickable link automatically, so never wrap it in markdown yourself:
  the phone as "+371 26 106 324", the studio Instagram as "@lavera.skin.atelier", the
  master's Instagram as "@Svetlana.Gavriluka".`;

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
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }
        ],
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
