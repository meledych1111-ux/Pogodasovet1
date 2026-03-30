import { getGameProgress, getOrRegisterPin } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { pin, gameType = 'tetris' } = req.query;
    
    if (!pin) {
      return res.status(400).json({ success: false, error: 'Missing pin' });
    }

    // Получаем анонимное имя из базы по ПИНу
    const { cloudName } = await getOrRegisterPin(pin);
    
    // Получаем прогресс из базы данных по анонимному имени
    const progress = await getGameProgress(cloudName, gameType);
    
    if (progress) {
      return res.status(200).json({ 
        success: true,
        cloudName: cloudName,
        progress: {
          score: parseInt(progress.score) || 0,
          level: parseInt(progress.level) || 1,
          lines: parseInt(progress.lines) || 0,
          has_progress: true
        }
      });
    } else {
      return res.status(200).json({ 
        success: true,
        cloudName: cloudName,
        progress: {
          score: 0,
          level: 1,
          lines: 0,
          has_progress: false
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error in get-progress:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}
