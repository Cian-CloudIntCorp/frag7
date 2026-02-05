export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json();
    
    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response("Missing Discord URL", { status: 500 });
    }

    // Determine the path label
    const isNewCell = data.intakePath === "register-new";
    const pathLabel = isNewCell ? "🚀 NEW CELL REGISTRATION" : "🔗 JOIN EXISTING/FRANCHISE";

    // Build fields dynamically
    const fields = [
      { name: "Protocol", value: pathLabel, inline: true },
      { name: "Skillset / Role", value: data.skillset || "N/A", inline: true },
      { name: "Email", value: data.yourEmail || "N/A" }
    ];

    // Add new cell details if they exist
    if (isNewCell) {
      fields.push({ name: "Team Name", value: data.cellName || "Not Provided" });
      fields.push({ name: "Specialty", value: data.missionSpecialty || "Not Provided" });
    }

    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "🚨 **NEW FRAG7⁷ SIGNAL**",
        embeds: [{
          title: "Inbound Member: " + (data.yourName || "Unknown"),
          color: isNewCell ? 0xffcc00 : 0x0099ff, // Gold for new cell, Blue for joining
          fields: fields,
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
