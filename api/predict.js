export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    const r = await fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`);
    const data = await r.json();
    const players = (data.players || []).slice(0, 5).map(p => ({
      name: p.player_name,
      dg_id: p.dg_id,
      fit: p.total_fit_adjustment || 0
    }));
    res.status(200).json({
      event_name: data.event_name || 'Unknown',
      course_name: data.course_name || 'Unknown',
      player_count: (data.players || []).length,
      sample: players
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
