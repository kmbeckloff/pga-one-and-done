export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  const sf = async (url) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return {};
      const text = await r.text();
      try { return JSON.parse(text); } catch(e) { return {}; }
    } catch(e) { return {}; }
  };

  const sa = (v) => Array.isArray(v) ? v : [];

  try {
    const [preds, decomp, betWin, sg, rankings, betT10, betMC, betFRL, mu] = await Promise.all([
      sf(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/preds/skill-ratings?display=value&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=top_10&odds_format=american&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=make_cut&odds_format=american&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=frl&odds_format=american&file_format=json&key=${key}`),
      sf(`https://feeds.datagolf.com/betting-tools/matchups?tour=pga&market=tournament_matchups&odds_format=american&file_format=json&key=${key}`)
    ]);

    if (!decomp.players) {
      return res.status(500).json({ error: 'No player data from DataGolf. Check your API key in Vercel environment variables.' });
    }

    const predsMap = {};
    sa(preds.baseline).forEach(p => {
      if (!p) return;
      if (p.dg_id) predsMap[p.dg_id] = p;
      if (p.player_name) predsMap[p.player_name.toLowerCase()] = p;
    });

    const sgMap = {};
    sa(sg.players || sg).forEach(p => { if (p && p.dg_id) sgMap[p.dg_id] = p; });

    const owgrMap = {};
    sa(rankings.rankings || rankings).forEach(p => { if (p && p.dg_id) owgrMap[p.dg_id] = p.owgr_rank || null; });

    const bWinMap = {}, bT10Map = {}, bMCMap = {}, bFRLMap = {};
    sa(betWin.odds).forEach(p => { if (p && p.dg_id) bWinMap[p.dg_id] = p; });
    sa(betT10.odds).forEach(p => { if (p && p.dg_id) bT10Map[p.dg_id] = p; });
    sa(betMC.odds).forEach(p => { if (p && p.dg_id) bMCMap[p.dg_id] = p; });
    sa(betFRL.odds).forEach(p => { if (p && p.dg_id) bFRLMap[p.dg_id] = p; });

    const parseOdds = (v) => {
      if (!v) return null;
      const n = parseInt(String(v).replace('+', ''));
      return isNaN(n) ? null : n;
    };

    const impliedPct = (odds) => {
      if (!odds) return null;
      return odds > 0 ? 100 / (odds + 100) * 100 : Math.abs(odds) / (Math.abs(odds) + 100) * 100;
    };

    const players = sa(decomp.players).map(p => {
      if (!p) return null;
      const pred = predsMap[p.dg_id] || predsMap[(p.player_name || '').toLowerCase()] || {};
      const s = sgMap[p.dg_id] || {};
      const bw = bWinMap[p.dg_id] || {};
      const bt = bT10Map[p.dg_id] || {};
      const bm = bMCMap[p.dg_id] || {};
      const bf = bFRLMap[p.dg_id] || {};

      const dk_win = parseOdds(bw.draftkings);
      const dk_top10 = parseOdds(bt.draftkings);
      const dk_mc = parseOdds(bm.draftkings);
      const dk_frl = parseOdds(bf.draftkings);
      const fit = p.total_fit_adjustment || 0;
      const hist = p.course_history_adjustment || 0;
      const app = p.cf_approach_comp || 0;
      const sgg = p.cf_short_comp || 0;
      const dna = (fit * 0.35) + (hist * 0.30) + (app * 0.20) + (sgg * 0.15);
      const winPct = (pred.win || 0) * 100;
      const bookImp = impliedPct(dk_win);
      const edge = bookImp ? winPct - bookImp : 0;

      const reasons = [];
      if (winPct > 10) reasons.push(`Elite win probability ${winPct.toFixed(1)}%`);
      else if (winPct > 5) reasons.push(`Strong ${winPct.toFixed(1)}% win probability`);
      if (hist > 0.1) reasons.push(`Excellent course history (+${hist.toFixed(2)})`);
      if (dna > 0.15) reasons.push(`Strong DNA fit score ${dna.toFixed(3)}`);
      if ((s.sg_app || 0) > 0.6) reasons.push(`Elite approach play SG +${s.sg_app.toFixed(2)}`);
      if ((s.sg_putt || 0) > 0.4) reasons.push(`Hot putter SG +${s.sg_putt.toFixed(2)}`);
      if ((s.sg_ott || 0) > 0.6) reasons.push(`Driving dominance SG +${s.sg_ott.toFixed(2)}`);
      if (edge > 2) reasons.push(`+${edge.toFixed(1)}% edge vs DraftKings`);
      if ((p.major_adjustment || 0) > 0.08) reasons.push(`Strong major performer`);
      if ((pred.top_10 || 0) * 100 > 40) reasons.push(`${((pred.top_10 || 0) * 100).toFixed(0)}% top-10 probability`);

      const sg_app = s.sg_app ?? null;
      const sg_arg = s.sg_arg ?? null;
      const sg_ott = s.sg_ott ?? null;

      return {
        player_name: p.player_name || '',
        dg_id: p.dg_id,
        country: p.country || '',
        age: p.age || null,
        owgr: owgrMap[p.dg_id] || null,
        win: winPct,
        top_5: (pred.top_5 || 0) * 100,
        top_10: (pred.top_10 || 0) * 100,
        top_20: (pred.top_20 || 0) * 100,
        make_cut: (pred.make_cut || 0) * 100,
        total_fit_adjustment: fit,
        course_history_adjustment: hist,
        cf_approach_comp: app,
        cf_short_comp: sgg,
        dna, final_pred: p.final_pred || 0,
        baseline_pred: p.baseline_pred || 0,
        age_adjustment: p.age_adjustment || 0,
        driving_distance_adjustment: p.driving_distance_adjustment || 0,
        driving_accuracy_adjustment: p.driving_accuracy_adjustment || 0,
        major_adjustment: p.major_adjustment || 0,
        timing_adjustment: p.timing_adjustment || 0,
        sg_putt: s.sg_putt ?? null, sg_arg, sg_app, sg_ott,
        sg_t2g: (sg_app !== null && sg_arg !== null && sg_ott !== null) ? parseFloat((sg_app + sg_arg + sg_ott).toFixed(3)) : null,
        sg_total: s.sg_total ?? null,
        driving_distance: s.driving_dist ?? null,
        driving_accuracy: s.driving_acc ?? null,
        dk_win, dk_top10, dk_mc, dk_frl,
        fanduel_win: bw.fanduel || null, caesars_win: bw.caesars || null,
        betmgm_win: bw.betmgm || null, pinnacle_win: bw.pinnacle || null,
        datagolf_baseline: (bw.datagolf || {}).baseline || null,
        fanduel_frl: bf.fanduel || null, caesars_frl: bf.caesars || null,
        datagolf_frl: (bf.datagolf || {}).baseline || null,
        book_implied: bookImp, edge_vs_book: edge,
        reasons: reasons.slice(0, 4)
      };
    }).filter(Boolean);

    players.sort((a, b) => b.win - a.win);

    const LOCATIONS = {
      'Masters Tournament':       { lat: 33.5031, lon: -82.0219, name: 'Augusta, GA' },
      'RBC Heritage':             { lat: 32.1416, lon: -80.8392, name: 'Hilton Head Island, SC' },
      'Truist Championship':      { lat: 33.0282, lon: -84.5773, name: 'Peachtree City, GA' },
      'PGA Championship':         { lat: 35.1495, lon: -80.8439, name: 'Charlotte, NC' },
      'U.S. Open':                { lat: 40.6259, lon: -74.0594, name: 'Shinnecock Hills, NY' },
      'The Open Championship':    { lat: 55.3781, lon: -3.4360,  name: 'Scotland, UK' },
      'The Players Championship': { lat: 30.1975, lon: -81.3964, name: 'Ponte Vedra Beach, FL' },
      'Memorial Tournament':      { lat: 40.0992, lon: -83.1521, name: 'Dublin, OH' },
    };

    res.status(200).json({
      event_name: preds.event_name || 'Current Tournament',
      last_updated: preds.last_updated || '',
      course_name: decomp.course_name || '',
      event_location: LOCATIONS[preds.event_name] || { lat: 32.1416, lon: -80.8392, name: 'Tournament Location' },
      players,
      matchups: sa(mu.matchups)
    });

  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
