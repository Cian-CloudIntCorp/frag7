export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. Parse the incoming data
    const data = await request.json();

    // --- 🔒 SECURITY CHECK (THE BOUNCER) ---
    const token = data['cf-turnstile-response'];
    const ip = request.headers.get('CF-Connecting-IP');

    // Make sure the Secret Key exists in your environment variables
    if (!env.TURNSTILE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Server Configuration Error: Missing Secret Key" }), { status: 500 });
    }

    // Verify the token with Cloudflare
    let formData = new FormData();
    formData.append('secret', env.TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    formData.append('remoteip', ip);

    const verificationUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    const result = await fetch(verificationUrl, {
      body: formData,
      method: 'POST',
    });

    const outcome = await result.json();

    // If the token is invalid (it's a bot), STOP here.
    if (!outcome.success) {
      return new Response(JSON.stringify({ error: "Bot detected. Security check failed." }), { status: 403 });
    }
    // --- 🔓 END SECURITY CHECK ---


    // 2. Proceed with Discord Logic (Only runs if human)
    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response("Missing Discord URL", { status: 500 });
    }

    // Determine the path label and visual theme
    const isNewCell = data.intakePath === "register-new";
    const pathLabel = isNewCell ? "🚀 NEW CELL REGISTRATION" : "🔗 JOIN EXISTING / FRANCHISE";
    const embedColor = isNewCell ? 0xeab308 : 0x3b82f6; // Yellow for new, Blue for join

    // Determine Consent Status
    const consentStatus = data.connectOptIn === "on" 
      ? "✅ **ACTIVE** (Assign Region Role)" 
      : "⛔ **DECLINED** (Do Not Contact)";

    // Build Standard Fields
    const fields = [
      { name: "Protocol", value: pathLabel, inline: true },
      { name: "Name / Handle", value: data.yourName || "Unknown", inline: true },
      { name: "🌍 Region / Base", value: data.location || "Unknown", inline: true }, 
      { name: "Signal (Email)", value: data.yourEmail || "N/A", inline: false },
      { name: "Skillset / MAG7 Role", value: data.skillset || "N/A", inline: false },
    ];

    // Add Conditional Fields
    if (isNewCell) {
      fields.push({ name: "Proposed Team Name", value: data.cellName || "Not Provided", inline: true });
      fields.push({ name: "Mission Specialty", value: data.missionSpecialty || "Not Provided", inline: true });
    }

    // Add Legal & Consent Status
    fields.push({ 
      name: "Sovereignty Pledge", 
      value: data.sovereigntyPledge === "on" ? "✅ AGREED" : "❌ NOT SIGNED", 
      inline: true 
    });

    fields.push({ 
      name: "📡 Cell Connection Signal", 
      value: consentStatus, 
      inline: false 
    });

    // Transmit to Discord
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "🚨 **NEW FRAG7⁷ INBOUND SIGNAL**",
        embeds: [{
          title: `Member Identification: ${data.yourName || "Unknown"}`,
          description: "A new entity has initiated the sequence to dismantle dependency.",
          color: embedColor,
          fields: fields,
          footer: { text: "FRAG7⁷ Cellular Intake Protocol" },
          timestamp: new Date().toISOString()
        }]
      })
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}