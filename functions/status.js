export async function onRequest(context) {
  const { env } = context;

  try {
    // Query: Count how many TECH and BIZ are waiting in each region
    const results = await env.DB.prepare(`
      SELECT region, role_class, COUNT(*) as count 
      FROM queue 
      WHERE status = 'WAITING' 
      GROUP BY region, role_class
    `).all();

    // Transform database rows into a clean JSON object
    // Example: { "uk_ireland": { tech: 2, biz: 0 }, "us_east": { tech: 3, biz: 0 } }
    const stats = {};

    if (results.results) {
        for (const row of results.results) {
            if (!stats[row.region]) stats[row.region] = { tech: 0, biz: 0 };
            
            if (row.role_class === 'TECH') stats[row.region].tech = row.count;
            if (row.role_class === 'BIZ') stats[row.region].biz = row.count;
        }
    }

    return new Response(JSON.stringify(stats), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
