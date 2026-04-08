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

    // Build a map from preds using baseline model
    const predsMap = {};
    if (preds.data && Array.isArray(preds.data)) {
      preds.data.forEach(entry => {
        if (entry.player_name) {
          predsMap[entry.player_name] = entry;
        }
      });
    }

    // Use decomp players as primary list — it has the full field
    const players = (decomp.players || []).map(p => {
      const pred = predsMap[p.player_name] || {};
      return {
        player_name: p.player_name,
        win: pred.win || 0,
        top_5: pred.top_5 || 0,
        top_10: pred.top_10 || 0,
        top_20: pred.top_20 || 0,
        make_cut: pred.make_cut || 0,
        total_fit_adjustment: p.total_fit_adjustment || 0,
        course_history_adjustment: p.course_history_adjustment || 0,
        cf_approach_comp: p.cf_approach_comp || 0,
        cf_short_comp: p.cf_short_comp || 0,
        final_pred: p.final_pred || 0
      };
    });

    res.status(200).json({
      event_name: preds.event_name || decomp.event_name,
      last_updated: preds.last_updated || decomp.last_updated,
      course_name: decomp.course_name || '',
      players: players,
      betting_odds: betting.odds || []
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
