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

    // Normalize name to "last, first" format for matching
    function normalizeName(name) {
      if (!name) return '';
      name = name.trim();
      // Already in "Last, First" format
      if (name.includes(',')) return name.toLowerCase();
      // Convert "First Last" to "last, first"
      const parts = name.split(' ');
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const first = parts.slice(0, parts.length - 1).join(' ');
        return `${last}, ${first}`.toLowerCase();
      }
      return name.toLowerCase();
    }

    // Build predsMap using dg_id as primary key, name as fallback
    const predsMapById = {};
    const predsMapByName = {};

    const rawData = preds.data;
    let predsArray = [];

    if (Array.isArray(rawData)) {
      predsArray = rawData;
    } else if (rawData && typeof rawData === 'object') {
      // Try baseline key first
      const nested = rawData.baseline || rawData.baseline_history_fit;
      if (Array.isArray(nested)) {
        predsArray = nested;
      } else {
        Object.values(rawData).forEach(arr => {
          if (Array.isArray(arr) && arr.length > predsArray.length) {
            predsArray = arr;
          }
        });
      }
    }

    predsArray.forEach(entry => {
      if (!entry) return;
      if (entry.dg_id) predsMapById[entry.dg_id] = entry;
      if (entry.player_name) predsMapByName[normalizeName(entry.player_name)] = entry;
    });

    // Build betting map
    const bettingMap = {};
    (betting.odds || []).forEach(p => {
      if (!p) return;
      if (p.dg_id) bettingMap[p.dg_id] = p;
      if (p.player_name) bettingMap[normalizeName(p.player_name)] = p;
    });

    // Use decomp players as primary list
    const players = (decomp.players || []).map(p => {
      // Try matching by dg_id first, then normalized name
      const pred = predsMapById[p.dg_id] || predsMapByName[normalizeName(p.player_name)] || {};
      const bet = bettingMap[p.dg_id] || bettingMap[normalizeName(p.player_name)] || {};

      // Parse American odds string to number
      const dkOdds = bet.draftkings ? parseInt(bet.draftkings.replace('+', '')) : null;

      return {
        player_name: p.player_name,
        dg_id: p.dg_id,
        win: pred.win || 0,
        top_5: pred.top_5 || 0,
        top_10: pred.top_10 || 0,
        top_20: pred.top_20 || 0,
        make_cut: pred.make_cut || 0,
        total_fit_adjustment: p.total_fit_adjustment || 0,
        course_history_adjustment: p.course_history_adjustment || 0,
        cf_approach_comp: p.cf_approach_comp || 0,
        cf_short_comp: p.cf_short_comp || 0,
        final_pred: p.final_pred || 0,
        dk_odds: dkOdds
      };
    });

    // Sort by final_pred descending
    players.sort((a, b) => b.final_pred - a.final_pred);

    res.status(200).json({
      event_name: preds.event_name || decomp.event_name,
      last_updated: preds.last_updated || decomp.last_updated,
      course_name: decomp.course_name || '',
      players: players
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
