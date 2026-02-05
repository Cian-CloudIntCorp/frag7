export default {
  async fetch(request, env) {
    // 1. Security: Handle CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "https://yourdomain.com", // Replace with your URL
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    try {
      const data = await request.json();

      // 2. Format the message for Discord
      const discordMessage = {
        content: "🚨 **New Federation Signal Received**",
        embeds: [{
          title: `New Member: ${data.yourName}`,
          color: 0x3b82f6, // Blue
          fields: [
            { name: "Protocol", value: data.intakePath, inline: true },
            { name: "Email", value: data.yourEmail, inline: true },
            { name: "Skillset", value: data.skillset, inline: true },
            { name: "Team/Cell", value: data.cellName || "N/A" },
            { name: "Specialty", value: data.missionSpecialty || "N/A" }
          ],
          footer: { text: "FRAG7⁷ Intake System" }
        }]
      };

      // 3. Send to Discord securely using an Environment Variable
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordMessage),
      });

      return new Response(JSON.stringify({ status: "success" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });

    } catch (err) {
      return new Response("Error processing signal", { status: 500 });
    }
  },
};
