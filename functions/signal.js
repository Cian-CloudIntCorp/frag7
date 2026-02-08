export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. Parse the incoming data
    const data = await request.json();

    // =========================================================
    // 🔒 SECURITY CHECK (THE BOUNCER)
    // =========================================================
    // We check the Cloudflare Turnstile token to stop bots
    if (env.TURNSTILE_SECRET_KEY) {
      const token = data['cf-turnstile-response'];
      const ip = request.headers.get('CF-Connecting-IP');

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
    }
    // 🔓 END SECURITY CHECK
    // =========================================================


    // =========================================================
    // 🗄️ DATABASE LOGIC (THE RECORDER & RECRUITER)
    // =========================================================
    
    // Track errors and success states to report to Discord later
    let dbError = null;
    let podAlert = null;

    // A. Classify the Skill (Tech vs Biz)
    // We look at the value from the dropdown (e.g. 'biz_1' vs 'infra_1')
    let roleClass = 'TECH'; 
    if (data.skillset && data.skillset.startsWith('biz_')) {
      roleClass = 'BIZ';
    }

    // B. Insert User into the Waiting Room
    // We try/catch this specifically so we can grab the error message if it fails
    try {
        if (!env.DB) {
            throw new Error("Database Binding 'DB' is missing in Cloudflare Settings.");
        }

        await env.DB.prepare(`
          INSERT INTO queue (email, discord, handle, region, role_class)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          data.yourEmail, 
          data.discordHandle || '', 
          data.yourName, 
          data.location, 
          roleClass
        ).run();

    } catch (err) {
        console.error("Database Insert Failed:", err);
        dbError = err.message; // Save this error to show in Discord
    }

    // C. Check for Pod Formation (The Matchmaker)
    // Only run this if the Insert succeeded
    if (!dbError && env.DB) {
        try {
            // Check: Do we have 3 Techs waiting in this region?
            const techList = await env.DB.prepare(`
              SELECT * FROM queue WHERE region = ? AND role_class = 'TECH' AND status = 'WAITING' LIMIT 3
            `).bind(data.location).all();

            // Check: Do we have 1 Biz waiting in this region?
            const bizList = await env.DB.prepare(`
              SELECT * FROM queue WHERE region = ? AND role_class = 'BIZ' AND status = 'WAITING' LIMIT 1
            `).bind(data.location).all();

            // If we have a full squad (3+1)
            if (techList.results.length >= 3 && bizList.results.length >= 1) {
                
                // 1. Create a Unique Pod ID
                const podName = `POD-${data.location.toUpperCase().substring(0,3)}-${Date.now().toString().slice(-4)}`;
                const squad = [...techList.results, ...bizList.results];
                const idsToUpdate = squad.map(u => u.id).join(',');

                // 2. Lock them in the DB so they can't be picked again
                await env.DB.prepare(`
                    UPDATE queue SET status = 'ASSIGNED', pod_name = ? 
                    WHERE id IN (${idsToUpdate})
                `).bind(podName).run();

                // 3. Build the "Victory" Alert for Discord
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
            // We don't fail the request here, we just log it.
        }
    }
    // =========================================================


    // =========================================================
    // 📡 DISCORD NOTIFICATION (THE LOGS)
    // =========================================================
    
    if (!env.DISCORD_WEBHOOK_URL) {
      return new Response("Missing Discord URL", { status: 500 });
    }

    // Visual Theme setup
    const isNewCell = data.intakePath === "register-new";
    const pathLabel = isNewCell ? "🚀 NEW CELL REGISTRATION" : "🔗 JOIN EXISTING / FRANCHISE";
    
    // If DB failed, turn the embed RED. If New Cell, YELLOW. If Join, BLUE.
    let embedColor = isNewCell ? 0xeab308 : 0x3b82f6; 
    if (dbError) {
        embedColor = 0xff0000; // RED for Error
    }

    const consentStatus = data.connectOptIn === "on" 
      ? "✅ **ACTIVE** (Assign Region Role)" 
      : "⛔ **DECLINED** (Do Not Contact)";

    // 1. Build Standard Fields
    const fields = [
      { name: "Protocol", value: pathLabel, inline: true },
      { name: "Name / Handle", value: data.yourName || "Unknown", inline: true },
      { name: "🌍 Region / Base", value: data.location || "Unknown", inline: true }, 
      { name: "Signal (Email)", value: data.yourEmail || "N/A", inline: false },
      { name: "Skillset / MAG7 Role", value: data.skillset || "N/A", inline: false },
    ];
    
    // 2. Add Discord Handle
    if (data.discordHandle) {
        fields.push({ name: "🆔 Discord ID", value: `\`${data.discordHandle}\``, inline: true });
    }

    // 3. Add Conditional Fields (New Cell info)
    if (isNewCell) {
      fields.push({ name: "Proposed Team Name", value: data.cellName || "Not Provided", inline: true });
      fields.push({ name: "Mission Specialty", value: data.missionSpecialty || "Not Provided", inline: true });
    }

    // 4. Add Legal & Consent Status
    fields.push({ name: "Sovereignty Pledge", value: data.sovereigntyPledge === "on" ? "✅ AGREED" : "❌ NOT SIGNED", inline: true });
    fields.push({ name: "📡 Cell Connection Signal", value: consentStatus, inline: false });

    // 5. CRITICAL: Add Database Error Field if it failed
    if (dbError) {
        fields.push({ 
            name: "⚠️ DATABASE SYSTEM FAILURE", 
            value: `**The user was NOT saved to the database.**\nError: \`${dbError}\`\n\n*Check Cloudflare D1 Bindings in Dashboard.*`, 
            inline: false 
        });
    }

    // Prepare the list of embeds
    const embeds = [{
         title: dbError ? "🚨 SYSTEM FAILURE: USER DATA NOT SAVED" : `Member Identification: ${data.yourName || "Unknown"}`,
         description: dbError ? "The security check passed, but the database rejected the entry." : "A new entity has initiated the sequence to dismantle dependency.",
         color: embedColor,
         fields: fields,
         footer: { text: "FRAG7⁷ Cellular Intake Protocol" },
         timestamp: new Date().toISOString()
    }];

    // If a pod was formed, attach that alert to the same message!
    if (podAlert) {
        embeds.push(podAlert);
    }

    // Transmit to Discord
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: dbError ? "🚨 **DATABASE ERROR** <@&ADMIN_ROLE_ID>" : (podAlert ? "🚨 **POD FORMED**" : "🚨 **NEW FRAG7⁷ INBOUND SIGNAL**"),
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