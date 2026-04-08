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

    // DEBUG: show raw preds structure
    const debugInfo = {
      preds_top_keys: Object.keys(preds),
      preds_data_type: typeof preds.data,
      preds_data_is_array: Array.isArray(preds.data),
      preds_data_length: Array.isArray(preds.data) ? preds.data.length : 'not array',
      preds_data_keys: preds.data && typeof preds.data === 'object' && !Array.isArray(preds.data) ? Object.keys(preds.data) : 'n/a',
      preds_first_item: Array.isArray(preds.data) && preds.data[0] ? Object.keys(preds.data[0]) : 'no items',
      decomp_player_count: (decomp.players || []).length,
      sample_decomp_player: decomp.players && decomp.players[0] ? decomp.players[0].player_name : 'none'
    };

    // Normalize name to lastname, firstname
    function normalizeName(name) {
      if (!name) return '';
      name = name.trim();
      if (name.includes(',')) return name.toLowerCase();
      const parts = name.split(' ');
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const first = parts.slice(0, parts.length - 1).join(' ');
        return `${last}, ${first}`.toLowerCase();
      }
      return name.toLowerCase();
    }

    // Build predsMap - try every possible data location
    const predsMapByName = {};
    const predsMapById = {};

    // Try preds.data as array
    if (Array.isArray(preds.data)) {
      preds.data.forEach(entry => {
        if (!entry) return;
        if (entry.dg_id) predsMapById[entry.dg_id] = entry;
        if (entry.player_name) predsMapByName[normalizeName(entry.player_name)] = entry;
      });
    }

    // Try preds.data.baseline
    if (preds.data && preds.data.baseline && Array.isArray(preds.data.baseline)) {
      preds.data.baseline.forEach(entry => {
        if (!entry) return;
        if (entry.dg_id) predsMapById[entry.dg_id] = entry;
        if (entry.player_name) predsMapByName[normalizeName(entry.player_name)] = entry;
      });
    }

    // Try preds directly as array
    if (Array.isArray(preds)) {
      preds.forEach(entry => {
        if (!entry) return;
        if (entry.dg_id) predsMapById[entry.dg_id] = entry;
        if (entry.player_name) predsMapByName[normalizeName(entry.player_name)] = entry;
      });
    }

    // Try any array inside preds
    Object.values(preds).forEach(val => {
      if (Array.isArray(val) && val.length > 0 && val[0] && val[0].player_name) {
        val.forEach(entry => {
          if (entry.dg_id) predsMapById[entry.dg_id] = entry;
          if (entry.player_name) predsMapByName[normalizeName(entry.player_name)] = entry;
        });
      }
    });

    debugInfo.preds_map_size_by_id = Object.keys(predsMapById).length;
    debugInfo.preds_map_size_by_name = Object.keys(predsMapByName).length;
    debugInfo.sample_pred_keys = Object.keys(predsMapByName).slice(0, 3);

    // Build betting map by dg_id
    const bettingMapById = {};
    (betting.odds || []).forEach(p => {
      if (p && p.dg_id) bettingMapById[p.dg_id] = p;
    });

    // Build players from decomp
    const players = (decomp.players || []).map(p => {
      const pred = predsMapById[p.dg_id] || predsMapByName[normalizeName(p.player_name)] || {};
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
        dk_odds: dkOdds,
        pred_found: Object.keys(pred).length > 0
      };
    });

    players.sort((a, b) => b.final_pred - a.final_pred);

    res.status(200).json({
      event_name: preds.event_name || decomp.event_name,
      last_updated: preds.last_updated || decomp.last_updated,
      course_name: decomp.course_name || '',
      players: players,
      debug: debugInfo
    });

  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}
