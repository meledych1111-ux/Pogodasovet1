import { getTopPlayers } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const result = await getTopPlayers('tetris', 10);
    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ Ошибка в top-players:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
