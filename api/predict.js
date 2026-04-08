export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const key = process.env.DATAGOLF_API_KEY;

  if (!key) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const [predsRes, decompRes, bettingRes] = await Promise.all([
      fetch(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`)
    ]);

    const preds = await predsRes.json();
    const decomp = await decompRes.json();
    const betting = await bettingRes.json();

    const players = [];
    if (preds.data) {
      preds.data.forEach(entry => {
        if (entry.player_name) {
          players.push(entry);
        }
      });
    }

    res.status(200).json({
      event_name: preds.event_name,
      last_updated: preds.last_updated,
      players: players,
      decomp_players: decomp.players || [],
      course_name: decomp.course_name || "",
      betting_odds: betting.odds || []
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
