export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    const [predsRes, decompRes, bettingRes, bettingTop5Res, bettingTop10Res, bettingMCRes, sgRes, rankingsRes, scheduleRes, matchupsRes] = await Promise.all([
      fetch(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=top_5&odds_format=american&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=top_10&odds_format=american&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=make_cut&odds_format=american&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/skill-ratings?display=value&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/get-schedule?tour=pga&season=2026&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/matchups?tour=pga&market=tournament_matchups&odds_format=american&file_format=json&key=${key}`)
    ]);

    const [preds, decomp, betting, bettingTop5, bettingTop10, bettingMC, sgRaw, rankingsRaw, schedule, matchups] = await Promise.all([
      predsRes.json(), decompRes.json(), bettingRes.json(),
      bettingTop5Res.json(), bettingTop10Res.json(), bettingMCRes.json(),
      sgRaw.json(), rankingsRaw.json(), scheduleRes.json(), matchupsRes.json()
    ]);

    const predsArray = preds.baseline || [];
    const predsMapById = {}, predsMapByName = {};
    predsArray.forEach(e => {
      if (!e) return;
      if (e.dg_id) predsMapById[e.dg_id] = e;
      if (e.player_name) predsMapByName[e.player_name.toLowerCase()] = e;
    });

    const sgMap = {};
    const sgArr = Array.isArray(sgRaw.players || sgRaw) ? (sgRaw.players || sgRaw) : Object.values(sgRaw.players || sgRaw || {});
    sgArr.forEach(p => { if (p?.dg_id) sgMap[p.dg_id] = p; });

    const owgrMap = {};
    const rankArr = Array.isArray(rankingsRaw.rankings || rankingsRaw) ? (rankingsRaw.rankings || rankingsRaw) : [];
    rankArr.forEach(p => { if (p?.dg_id) owgrMap[p.dg_id] = p.owgr_rank || null; });

    const buildBetMap = (bData) => {
      const m = {};
      (bData.odds || bData || []).forEach(p => { if (p?.dg_id) m[p.dg_id] = p; });
      return m;
    };
    const betWinMap = buildBetMap(betting);
    const betTop5Map = buildBetMap(bettingTop5);
    const betTop10Map = buildBetMap(bettingTop10);
    const betMCMap = buildBetMap(bettingMC);

    // Get location from schedule for weather
    const eventId = decomp.event_id;
    let lat = 33.5031, lon = -82.0219, locationName = 'Augusta, GA'; // Masters default
    if (schedule.schedule) {
      const evt = schedule.schedule.find(e => e.event_name === preds.event_name);
      if (evt?.lat && evt?.lon) { lat = evt.lat; lon = evt.lon; locationName = `${evt.location || ''}`; }
    }

    const players = (decomp.players || []).map(p => {
      const pred = predsMapById[p.dg_id] || predsMapByName[p.player_name.toLowerCase()] || {};
      const sg = sgMap[p.dg_id] || {};
      const bWin = betWinMap[p.dg_id] || {};
      const bT5 = betTop5Map[p.dg_id] || {};
      const bT10 = betTop10Map[p.dg_id] || {};
      const bMC = betMCMap[p.dg_id] || {};
      const dkWin = bWin.draftkings ? parseInt(bWin.draftkings.replace('+','')) : null;
      const dkT5 = bT5.draftkings ? parseInt(bT5.draftkings.replace('+','')) : null;
      const dkT10 = bT10.draftkings ? parseInt(bT10.draftkings.replace('+','')) : null;
      const dkMC = bMC.draftkings ? parseInt(bMC.draftkings.replace('+','')) : null;

      const fit = p.total_fit_adjustment || 0;
      const hist = p.course_history_adjustment || 0;
      const app = p.cf_approach_comp || 0;
      const sg_game = p.cf_short_comp || 0;
      const dna = (fit*0.35)+(hist*0.30)+(app*0.20)+(sg_game*0.15);

      const winPct = (pred.win||0)*100;
      const bookImplied = dkWin ? (dkWin>0 ? 100/(dkWin+100)*100 : Math.abs(dkWin)/(Math.abs(dkWin)+100)*100) : null;
      const edge = bookImplied ? winPct - bookImplied : 0;

      // Generate pick reasoning
      const reasons = [];
      if (winPct > 10) reasons.push(`Elite win probability of ${winPct.toFixed(1)}%`);
      else if (winPct > 5) reasons.push(`Strong ${winPct.toFixed(1)}% win probability`);
      if (hist > 0.1) reasons.push(`Excellent course history (+${hist.toFixed(2)} SG adj)`);
      if (dna > 0.15) reasons.push(`Strong course DNA fit score of ${dna.toFixed(3)}`);
      if ((sg.sg_app||0) > 0.6) reasons.push(`Elite approach play (SG +${sg.sg_app.toFixed(2)})`);
      if ((sg.sg_putt||0) > 0.4) reasons.push(`Hot putter (SG +${sg.sg_putt.toFixed(2)})`);
      if ((sg.sg_ott||0) > 0.6) reasons.push(`Driving dominance (SG +${sg.sg_ott.toFixed(2)})`);
      if (edge > 2) reasons.push(`Model shows +${edge.toFixed(1)}% edge vs DraftKings`);
      if (p.major_adjustment > 0.08) reasons.push(`Strong major tournament performer`);
      if ((pred.top_10||0)*100 > 40) reasons.push(`${((pred.top_10||0)*100).toFixed(0)}% top-10 probability`);

      return {
        player_name: p.player_name, dg_id: p.dg_id, country: p.country||'', age: p.age,
        owgr: owgrMap[p.dg_id]||null,
        win: (pred.win||0)*100, top_5: (pred.top_5||0)*100, top_10: (pred.top_10||0)*100,
        top_20: (pred.top_20||0)*100, make_cut: (pred.make_cut||0)*100,
        total_fit_adjustment: fit, course_history_adjustment: hist,
        cf_approach_comp: app, cf_short_comp: sg_game, dna,
        final_pred: p.final_pred||0, baseline_pred: p.baseline_pred||0,
        age_adjustment: p.age_adjustment||0,
        driving_distance_adjustment: p.driving_distance_adjustment||0,
        driving_accuracy_adjustment: p.driving_accuracy_adjustment||0,
        major_adjustment: p.major_adjustment||0,
        timing_adjustment: p.timing_adjustment||0,
        sg_putt: sg.sg_putt??null, sg_arg: sg.sg_arg??null, sg_app: sg.sg_app??null,
        sg_ott: sg.sg_ott??null,
        sg_t2g: (sg.sg_app!=null&&sg.sg_arg!=null&&sg.sg_ott!=null) ? parseFloat((sg.sg_app+sg.sg_arg+sg.sg_ott).toFixed(3)) : null,
        sg_total: sg.sg_total??null,
        driving_distance: sg.driving_dist??null, driving_accuracy: sg.driving_acc??null,
        dk_win: dkWin, dk_top5: dkT5, dk_top10: dkT10, dk_mc: dkMC,
        pinnacle_win: bWin.pinnacle||null, fanduel_win: bWin.fanduel||null,
        caesars_win: bWin.caesars||null, betmgm_win: bWin.betmgm||null,
        datagolf_baseline: bWin.datagolf?.baseline||null,
        book_implied: bookImplied, edge_vs_book: edge,
        reasons: reasons.slice(0,4)
      };
    });

    players.sort((a,b) => b.win - a.win);

    const matchupsList = (matchups.matchups || []).slice(0, 20);

    res.status(200).json({
      event_name: preds.event_name, last_updated: preds.last_updated,
      course_name: decomp.course_name||'',
      event_location: { lat, lon, name: locationName },
      players, matchups: matchupsList
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
