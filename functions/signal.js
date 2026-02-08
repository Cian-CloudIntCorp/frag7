export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json();
    
    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response("Missing Discord URL", { status: 500 });
    }

    // Determine the path label and visual theme
    const isNewCell = data.intakePath === "register-new";
    const pathLabel = isNewCell ? "🚀 NEW CELL REGISTRATION" : "🔗 JOIN EXISTING / FRANCHISE";
    const embedColor = isNewCell ? 0xeab308 : 0x3b82f6; // Yellow for new, Blue for join

    // Determine Consent Status (Checkbox usually sends 'on' if checked, undefined if not)
    const consentStatus = data.connectOptIn === "on" 
      ? "✅ **ACTIVE** (Assign Region Role)" 
      : "⛔ **DECLINED** (Do Not Contact)";

    // 1. Build Standard Fields (Present in all submissions)
    const fields = [
      { name: "Protocol", value: pathLabel, inline: true },
      { name: "Name / Handle", value: data.yourName || "Unknown", inline: true },
      // New Region Field
      { name: "🌍 Region / Base", value: data.location || "Unknown", inline: true }, 
      
      { name: "Signal (Email)", value: data.yourEmail || "N/A", inline: false },
      { name: "Skillset / MAG7 Role", value: data.skillset || "N/A", inline: false },
    ];

    // 2. Add Conditional Fields (Only if 'Register New Cell' was chosen)
    if (isNewCell) {
      fields.push({ name: "Proposed Team Name", value: data.cellName || "Not Provided", inline: true });
      fields.push({ name: "Mission Specialty", value: data.missionSpecialty || "Not Provided", inline: true });
    }

    // 3. Add Legal & Consent Status
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

    // 4. Transmit to Discord
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