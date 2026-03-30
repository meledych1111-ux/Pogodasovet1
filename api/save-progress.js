import { saveGameProgress, deleteGameProgress, getGameProgress, generateAnonymousName } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { action, session_id, gameType = 'tetris', score, level, lines } = req.body;
    
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'Missing session_id' });
    }

    // Превращаем анонимный ID сессии в публичное Облачное Имя
    const cloudName = generateAnonymousName(session_id);
    
    if (action === 'save') {
      await saveGameProgress(cloudName, gameType, parseInt(score || 0), parseInt(level || 1), parseInt(lines || 0));
      return res.status(200).json({ success: true, message: 'Progress saved' });
    } else if (action === 'delete') {
      await deleteGameProgress(cloudName, gameType);
      return res.status(200).json({ success: true, message: 'Progress deleted' });
    }
    
    return res.status(400).json({ success: false, error: 'Invalid action' });
  } catch (error) {
    console.error('❌ Error in save-progress:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}
