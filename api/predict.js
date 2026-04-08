export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const key = process.env.DATAGOLF_API_KEY;

  try {
    const [predsRes, decompRes, bettingRes] = await Promise.all([
      fetch(`https://feeds.datagolf.com/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/preds/player-decompositions?tour=pga&file_format=json&key=${key}`),
      fetch(`https://feeds.datagolf.com/betting-tools/outrights?tour=pga&market=win&odds_format=american&file_format=json&key=${key}`)
    ]);

    const [preds, decomp, betting] = await Promise.all([
      predsRes.json(),
      decompRes.json(),
      bettingRes.json()
    ]);

    res.status(200).json({ preds, decomp, betting });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
