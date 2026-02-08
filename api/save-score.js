import { saveGameScore } from './init-db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris', score, level, lines } = req.body;
    
    if (!userId || score === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId and score' 
      });
    }

    const resultId = await saveGameScore(userId, gameType, score, level || 1, lines || 0);
    
    return res.status(200).json({ 
      success: true, 
      id: resultId,
      message: 'Score saved successfully'
    });
    
  } catch (error) {
    console.error('Error saving score:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
