export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    // Batch 1 — core data
    const [predsRes, decompRes, bettingRes, sgRes, rankingsRes] = await Promise.all([
      fetch(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/skill-ratings?display=value&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=${key}`)
    ]);

    if (!predsRes.ok) throw new Error(`Predictions endpoint returned ${predsRes.status}`);
    if (!decompRes.ok) throw new Error(`Decompositions endpoint returned ${decompRes.status}`);

    const preds = await predsRes.json();
    const decomp = await decompRes.json();
    const betting = bettingRes.ok ? await bettingRes.json() : {};
    const sgRaw = sgRes.ok ? await sgRes.json() : {};
    const rankingsRaw = rankingsRes.ok ? await rankingsRes.json() : {};

    // Batch 2 — additional betting markets (each independently best-effort)
    let bettingTop10 = {}, bettingMC = {}, matchups = {}, bettingFRL = {};
    const safeFetch = async (url) => {
      try { const r = await fetch(url); if (!r.ok) return {}; return await r.json(); }
      catch(e) { return {}; }
    };
    [bettingTop10, bettingMC, matchups, bettingFRL] = await Promise.all([
      safeFetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=top_10&odds_format=american&file_format=json&key=${key}`),
      safeFetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=make_cut&odds_format=american&file_format=json&key=${key}`),
      safeFetch(`https://feeds.datagolf.com/betting-tools/matchups?tour=pga&market=tournament_matchups&odds_format=american&file_format=json&key=${key}`),
      safeFetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=frl&odds_format=american&file_format=json&key=${key}`)
    ]);

    // Build maps
    const predsArray = preds.baseline || [];
    const predsMapById = {}, predsMapByName = {};
    predsArray.forEach(e => {
      if (!e) return;
      if (e.dg_id) predsMapById[e.dg_id] = e;
      if (e.player_name) predsMapByName[e.player_name.toLowerCase()] = e;
    });

    const sgMap = {};
    const sgArr = Array.isArray(sgRaw) ? sgRaw : (sgRaw.players || []);
    sgArr.forEach(p => { if (p?.dg_id) sgMap[p.dg_id] = p; });

    const owgrMap = {};
    const rankArr = Array.isArray(rankingsRaw) ? rankingsRaw : (rankingsRaw.rankings || []);
    rankArr.forEach(p => { if (p?.dg_id) owgrMap[p.dg_id] = p.owgr_rank || null; });

    const betWinMap = {};
    (betting.odds || []).forEach(p => { if (p?.dg_id) betWinMap[p.dg_id] = p; });

    const betT10Map = {};
    (bettingTop10.odds || []).forEach(p => { if (p?.dg_id) betT10Map[p.dg_id] = p; });

    const betMCMap = {};
    (bettingMC.odds || []).forEach(p => { if (p?.dg_id) betMCMap[p.dg_id] = p; });

    const betFRLMap = {};
    (bettingFRL.odds || []).forEach(p => { if (p?.dg_id) betFRLMap[p.dg_id] = p; });

    // Build players
    const players = (decomp.players || []).map(p => {
      const pred = predsMapById[p.dg_id] || predsMapByName[p.player_name.toLowerCase()] || {};
      const sg = sgMap[p.dg_id] || {};
      const bWin = betWinMap[p.dg_id] || {};
      const bT10 = betT10Map[p.dg_id] || {};
      const bMC = betMCMap[p.dg_id] || {};

      const parseOdds = (v) => v ? parseInt(String(v).replace('+','')) : null;
      const dk_win = parseOdds(bWin.draftkings);
      const dk_top10 = parseOdds(bT10.draftkings);
      const dk_mc = parseOdds(bMC.draftkings);

      const fit = p.total_fit_adjustment || 0;
      const hist = p.course_history_adjustment || 0;
      const app = p.cf_approach_comp || 0;
      const sg_game = p.cf_short_comp || 0;
      const dna = (fit*0.35)+(hist*0.30)+(app*0.20)+(sg_game*0.15);
      const winPct = (pred.win||0)*100;
      const bookImplied = dk_win ? (dk_win>0 ? 100/(dk_win+100)*100 : Math.abs(dk_win)/(Math.abs(dk_win)+100)*100) : null;
      const edge = bookImplied ? winPct - bookImplied : 0;

      // Generate pick reasons
      const reasons = [];
      if (winPct > 10) reasons.push(`Elite win probability ${winPct.toFixed(1)}%`);
      else if (winPct > 5) reasons.push(`Strong ${winPct.toFixed(1)}% win probability`);
      if (hist > 0.1) reasons.push(`Excellent course history (+${hist.toFixed(2)})`);
      if (dna > 0.15) reasons.push(`Strong DNA fit score ${dna.toFixed(3)}`);
      if ((sg.sg_app||0) > 0.6) reasons.push(`Elite approach play SG +${sg.sg_app.toFixed(2)}`);
      if ((sg.sg_putt||0) > 0.4) reasons.push(`Hot putter SG +${sg.sg_putt.toFixed(2)}`);
      if ((sg.sg_ott||0) > 0.6) reasons.push(`Driving dominance SG +${sg.sg_ott.toFixed(2)}`);
      if (edge > 2) reasons.push(`Model shows +${edge.toFixed(1)}% edge vs DraftKings`);
      if ((p.major_adjustment||0) > 0.08) reasons.push(`Strong major performer`);
      if ((pred.top_10||0)*100 > 40) reasons.push(`${((pred.top_10||0)*100).toFixed(0)}% top-10 probability`);

      return {
        player_name: p.player_name,
        dg_id: p.dg_id,
        country: p.country || '',
        age: p.age,
        owgr: owgrMap[p.dg_id] || null,
        win: winPct,
        top_5: (pred.top_5||0)*100,
        top_10: (pred.top_10||0)*100,
        top_20: (pred.top_20||0)*100,
        make_cut: (pred.make_cut||0)*100,
        total_fit_adjustment: fit,
        course_history_adjustment: hist,
        cf_approach_comp: app,
        cf_short_comp: sg_game,
        dna,
        final_pred: p.final_pred || 0,
        baseline_pred: p.baseline_pred || 0,
        age_adjustment: p.age_adjustment || 0,
        driving_distance_adjustment: p.driving_distance_adjustment || 0,
        driving_accuracy_adjustment: p.driving_accuracy_adjustment || 0,
        major_adjustment: p.major_adjustment || 0,
        timing_adjustment: p.timing_adjustment || 0,
        sg_putt: sg.sg_putt ?? null,
        sg_arg: sg.sg_arg ?? null,
        sg_app: sg.sg_app ?? null,
        sg_ott: sg.sg_ott ?? null,
        sg_t2g: (sg.sg_app!=null&&sg.sg_arg!=null&&sg.sg_ott!=null) ? parseFloat((sg.sg_app+sg.sg_arg+sg.sg_ott).toFixed(3)) : null,
        sg_total: sg.sg_total ?? null,
        driving_distance: sg.driving_dist ?? null,
        driving_accuracy: sg.driving_acc ?? null,
        dk_win, dk_top10, dk_mc,
        dk_frl: (() => { const b = betFRLMap[p.dg_id]||{}; return b.draftkings ? parseInt(String(b.draftkings).replace('+','')) : null; })(),
        fanduel_frl: (betFRLMap[p.dg_id]||{}).fanduel || null,
        caesars_frl: (betFRLMap[p.dg_id]||{}).caesars || null,
        datagolf_frl: (betFRLMap[p.dg_id]||{}).datagolf?.baseline || null,
        fanduel_win: bWin.fanduel || null,
        caesars_win: bWin.caesars || null,
        betmgm_win: bWin.betmgm || null,
        pinnacle_win: bWin.pinnacle || null,
        datagolf_baseline: bWin.datagolf?.baseline || null,
        book_implied: bookImplied,
        edge_vs_book: edge,
        reasons: reasons.slice(0,4)
      };
    });

    players.sort((a,b) => b.win - a.win);

    // Event location — map common tournaments, fallback to Harbour Town for RBC
    const LOCATIONS = {
      'Masters Tournament':     { lat: 33.5031, lon: -82.0219, name: 'Augusta, GA' },
      'RBC Heritage':           { lat: 32.1416, lon: -80.8392, name: 'Hilton Head Island, SC' },
      'Truist Championship':    { lat: 33.0282, lon: -84.5773, name: 'Peachtree City, GA' },
      'PGA Championship':       { lat: 35.1495, lon: -80.8439, name: 'Charlotte, NC' },
      'U.S. Open':              { lat: 40.6259, lon: -74.0594, name: 'Shinnecock Hills, NY' },
      'The Open Championship':  { lat: 55.3781, lon: -3.4360,  name: 'Scotland, UK' },
      'The Players Championship': { lat: 30.1975, lon: -81.3964, name: 'Ponte Vedra Beach, FL' },
      'Memorial Tournament':    { lat: 40.0992, lon: -83.1521, name: 'Dublin, OH' },
    };
    const eventLocation = LOCATIONS[preds.event_name] || { lat: 33.5031, lon: -82.0219, name: 'Tournament Location' };

    res.status(200).json({
      event_name: preds.event_name,
      last_updated: preds.last_updated,
      course_name: decomp.course_name || '',
      event_location: eventLocation,
      players,
      matchups: matchups.matchups || []
    });

  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
