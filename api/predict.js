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
    const [predsRes, decompRes, bettingRes, sgRes, rankingsRes] = await Promise.all([
      fetch(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/skill-ratings?display=value&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=${key}`)
    ]);

    const preds = await predsRes.json();
    const decomp = await decompRes.json();
    const betting = await bettingRes.json();
    const sgRaw = await sgRes.json();
    const rankingsRaw = await rankingsRes.json();

    // Build predsMap from preds.baseline
    const predsArray = preds.baseline || [];
    const predsMapById = {};
    const predsMapByName = {};
    predsArray.forEach(entry => {
      if (!entry) return;
      if (entry.dg_id) predsMapById[entry.dg_id] = entry;
      if (entry.player_name) predsMapByName[entry.player_name.toLowerCase()] = entry;
    });

    // Build SG map — skill ratings returns { players: [...] } or direct array
    const sgMap = {};
    const sgPlayers = sgRaw.players || sgRaw || [];
    const sgArr = Array.isArray(sgPlayers) ? sgPlayers : Object.values(sgPlayers);
    sgArr.forEach(p => {
      if (!p) return;
      if (p.dg_id) sgMap[p.dg_id] = p;
    });

    // Build OWGR map from DG rankings
    const owgrMap = {};
    const rankPlayers = rankingsRaw.rankings || rankingsRaw || [];
    const rankArr = Array.isArray(rankPlayers) ? rankPlayers : Object.values(rankPlayers);
    rankArr.forEach(p => {
      if (!p) return;
      if (p.dg_id) owgrMap[p.dg_id] = p.owgr_rank || null;
    });

    // Build betting map by dg_id
    const bettingMapById = {};
    (betting.odds || []).forEach(p => {
      if (p && p.dg_id) bettingMapById[p.dg_id] = p;
    });

    // Build players from decomp
    const players = (decomp.players || []).map(p => {
      const pred = predsMapById[p.dg_id] || predsMapByName[p.player_name.toLowerCase()] || {};
      const bet = bettingMapById[p.dg_id] || {};
      const sgData = sgMap[p.dg_id] || {};
      const dkOdds = bet.draftkings ? parseInt(bet.draftkings.replace('+', '')) : null;
      const owgr = owgrMap[p.dg_id] || null;

      return {
        player_name: p.player_name,
        dg_id: p.dg_id,
        country: p.country || '',
        age: p.age || null,
        owgr: owgr,
        // Predictions
        win: pred.win || 0,
        top_5: pred.top_5 || 0,
        top_10: pred.top_10 || 0,
        top_20: pred.top_20 || 0,
        make_cut: pred.make_cut || 0,
        // Decomp
        total_fit_adjustment: p.total_fit_adjustment || 0,
        course_history_adjustment: p.course_history_adjustment || 0,
        cf_approach_comp: p.cf_approach_comp || 0,
        cf_short_comp: p.cf_short_comp || 0,
        final_pred: p.final_pred || 0,
        baseline_pred: p.baseline_pred || 0,
        age_adjustment: p.age_adjustment || 0,
        driving_distance_adjustment: p.driving_distance_adjustment || 0,
        driving_accuracy_adjustment: p.driving_accuracy_adjustment || 0,
        major_adjustment: p.major_adjustment || 0,
        timing_adjustment: p.timing_adjustment || 0,
        total_course_history_adjustment: p.total_course_history_adjustment || 0,
        // Live SG stats from skill ratings
        sg_putt: sgData.sg_putt !== undefined ? sgData.sg_putt : null,
        sg_arg: sgData.sg_arg !== undefined ? sgData.sg_arg : null,
        sg_app: sgData.sg_app !== undefined ? sgData.sg_app : null,
        sg_ott: sgData.sg_ott !== undefined ? sgData.sg_ott : null,
        sg_t2g: (sgData.sg_app !== undefined && sgData.sg_arg !== undefined && sgData.sg_ott !== undefined) ? parseFloat((sgData.sg_app + sgData.sg_arg + sgData.sg_ott).toFixed(3)) : null,
        sg_total: sgData.sg_total !== undefined ? sgData.sg_total : null,
        driving_distance: sgData.driving_dist !== undefined ? sgData.driving_dist : null,
        driving_accuracy: sgData.driving_acc !== undefined ? sgData.driving_acc : null,

        // Betting
        dk_odds: dkOdds,
        dk_odds_str: bet.draftkings || null,
        pinnacle_odds: bet.pinnacle || null,
        fanduel_odds: bet.fanduel || null
      };
    });

    players.sort((a, b) => b.win - a.win);

    res.status(200).json({
      event_name: preds.event_name,
      last_updated: preds.last_updated,
      course_name: decomp.course_name || '',
      players: players,
      debug_sg_sample: sgArr[0] ? Object.keys(sgArr[0]) : [],
      debug_rank_sample: rankArr[0] ? Object.keys(rankArr[0]) : []
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
