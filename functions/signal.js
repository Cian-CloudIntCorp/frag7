export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. Parse the incoming data
    const data = await request.json();

    // =========================================================
    // 🔒 SECURITY CHECK (THE BOUNCER)
    // =========================================================
    const token = data['cf-turnstile-response'];
    const ip = request.headers.get('CF-Connecting-IP');

    if (!env.TURNSTILE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Server Configuration Error: Missing Secret Key" }), { status: 500 });
    }

    let formData = new FormData();
    formData.append('secret', env.TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    formData.append('remoteip', ip);

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      body: formData,
      method: 'POST',
    });

    const outcome = await result.json();

    if (!outcome.success) {
      return new Response(JSON.stringify({ error: "Bot detected. Security check failed." }), { status: 403 });
    }
    // 🔓 END SECURITY CHECK
    // =========================================================


    // =========================================================
    // 🗄️ DATABASE LOGIC (THE POD BUILDER)
    // =========================================================
    
    // A. Classify the Skill (Tech vs Biz)
    // We look at the value from the dropdown (e.g. 'biz_1' vs 'infra_1')
    let roleClass = 'TECH'; 
    if (data.skillset && data.skillset.startsWith('biz_')) {
      roleClass = 'BIZ';
    }

    // B. Insert User into the Waiting Room
    // We try/catch this part so if the DB fails, we still send the Discord alert (fail-safe)
    try {
        await env.DB.prepare(`
          INSERT INTO queue (email, discord, handle, region, role_class)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          data.yourEmail, 
          data.discordHandle, 
          data.yourName, 
          data.location, 
          roleClass
        ).run();
    } catch (dbErr) {
        console.error("Database Insert Failed:", dbErr);
        // We continue... we don't want to crash the whole user experience just because the DB hiccuped.
    }

    // C. Check for Pod Formation (The Matchmaker)
    // Rule: 3 Tech + 1 Biz in the same region
    let podAlert = null; // We will fill this if a pod is created

    try {
        const techList = await env.DB.prepare(`
          SELECT * FROM queue WHERE region = ? AND role_class = 'TECH' AND status = 'WAITING' LIMIT 3
        `).bind(data.location).all();

        const bizList = await env.DB.prepare(`
          SELECT * FROM queue WHERE region = ? AND role_class = 'BIZ' AND status = 'WAITING' LIMIT 1
        `).bind(data.location).all();

        if (techList.results.length >= 3 && bizList.results.length >= 1) {
            // WE HAVE A MATCH!
            const podName = `POD-${data.location.toUpperCase().substring(0,3)}-${Date.now().toString().slice(-4)}`;
            const squad = [...techList.results, ...bizList.results];
            const idsToUpdate = squad.map(u => u.id).join(',');

            // Lock them in the DB
            await env.DB.prepare(`
                UPDATE queue SET status = 'ASSIGNED', pod_name = ? 
                WHERE id IN (${idsToUpdate})
            `).bind(podName).run();

            // Build the Special Alert for Discord
            const rosterText = squad.map(u => 
                `• **${u.role_class}**: ${u.handle} (Discord: \`${u.discord || 'N/A'}\`)`
            ).join('\n');

            podAlert = {
                title: `🚨 UNIT ACTIVATED: ${podName}`,
                description: `**Action Required:** Create private channel in **${data.location}** and invite these members:`,
                color: 0x00ff00, // Bright Green
                fields: [{ name: "The Roster", value: rosterText }],
                footer: { text: "Auto-Assembled by FRAG7 Core" }
            };
        }
    } catch (matchErr) {
        console.error("Pod Matching Logic Failed:", matchErr);
    }
    // =========================================================


    // =========================================================
    // 📡 DISCORD NOTIFICATION (THE LOGS)
    // =========================================================
    
    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response("Missing Discord URL", { status: 500 });
    }

    const isNewCell = data.intakePath === "register-new";
    const pathLabel = isNewCell ? "🚀 NEW CELL REGISTRATION" : "🔗 JOIN EXISTING / FRANCHISE";
    const embedColor = isNewCell ? 0xeab308 : 0x3b82f6; 

    const consentStatus = data.connectOptIn === "on" 
      ? "✅ **ACTIVE** (Assign Region Role)" 
      : "⛔ **DECLINED** (Do Not Contact)";

    const fields = [
      { name: "Protocol", value: pathLabel, inline: true },
      { name: "Name / Handle", value: data.yourName || "Unknown", inline: true },
      { name: "🌍 Region / Base", value: data.location || "Unknown", inline: true }, 
      { name: "Signal (Email)", value: data.yourEmail || "N/A", inline: false },
      { name: "Skillset / MAG7 Role", value: data.skillset || "N/A", inline: false },
    ];
    
    // Add Discord Handle to the log so admins can find them easily
    if (data.discordHandle) {
        fields.push({ name: "🆔 Discord ID", value: `\`${data.discordHandle}\``, inline: true });
    }

    if (isNewCell) {
      fields.push({ name: "Proposed Team Name", value: data.cellName || "Not Provided", inline: true });
      fields.push({ name: "Mission Specialty", value: data.missionSpecialty || "Not Provided", inline: true });
    }

    fields.push({ name: "Sovereignty Pledge", value: data.sovereigntyPledge === "on" ? "✅ AGREED" : "❌ NOT SIGNED", inline: true });
    fields.push({ name: "📡 Cell Connection Signal", value: consentStatus, inline: false });

    // Prepare the list of embeds (Standard Log + Optional Pod Alert)
    const embeds = [{
         title: `Member Identification: ${data.yourName || "Unknown"}`,
         description: "A new entity has initiated the sequence to dismantle dependency.",
         color: embedColor,
         fields: fields,
         footer: { text: "FRAG7⁷ Cellular Intake Protocol" },
         timestamp: new Date().toISOString()
    }];

    // If a pod was formed, attach that alert to the same message!
    if (podAlert) {
        embeds.push(podAlert);
    }

    // Transmit
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: podAlert ? "🚨 **POD FORMED**" : "🚨 **NEW FRAG7⁷ INBOUND SIGNAL**",
        embeds: embeds
      })
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}