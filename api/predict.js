export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    const [predsRes, decompRes, bettingRes] = await Promise.all([
      fetch(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`)
    ]);

    const preds = await predsRes.json();
    const decomp = await decompRes.json();
    const betting = await bettingRes.json();

    // Data is in preds.baseline (not preds.data)
    const predsArray = preds.baseline || [];

    const predsMapById = {};
    const predsMapByName = {};
    predsArray.forEach(entry => {
      if (!entry) return;
      if (entry.dg_id) predsMapById[entry.dg_id] = entry;
      if (entry.player_name) predsMapByName[entry.player_name.toLowerCase()] = entry;
    });

    // Build betting map by dg_id
    const bettingMapById = {};
    (betting.odds || []).forEach(p => {
      if (p && p.dg_id) bettingMapById[p.dg_id] = p;
    });

    // Build players from decomp using dg_id to match predictions
    const players = (decomp.players || []).map(p => {
      const pred = predsMapById[p.dg_id] || predsMapByName[p.player_name.toLowerCase()] || {};
      const bet = bettingMapById[p.dg_id] || {};
      const dkOdds = bet.draftkings ? parseInt(bet.draftkings.replace('+', '')) : null;

      return {
        player_name: p.player_name,
        dg_id: p.dg_id,
        win: (pred.win || 0) * 100,
        top_5: (pred.top_5 || 0) * 100,
        top_10: (pred.top_10 || 0) * 100,
        top_20: (pred.top_20 || 0) * 100,
        make_cut: (pred.make_cut || 0) * 100,
        total_fit_adjustment: p.total_fit_adjustment || 0,
        course_history_adjustment: p.course_history_adjustment || 0,
        cf_approach_comp: p.cf_approach_comp || 0,
        cf_short_comp: p.cf_short_comp || 0,
        final_pred: p.final_pred || 0,
        dk_odds: dkOdds
      };
    });

    // Sort by win probability descending
    players.sort((a, b) => b.win - a.win);

    res.status(200).json({
      event_name: preds.event_name,
      last_updated: preds.last_updated,
      course_name: decomp.course_name || '',
      players: players
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
