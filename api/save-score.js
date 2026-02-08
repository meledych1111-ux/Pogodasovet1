const { saveGameScore } = require('./db.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gameType = 'tetris', score, level, lines } = req.body;
    
    if (!userId || score === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    const resultId = await saveGameScore(userId, gameType, score, level || 1, lines || 0);
    
    return res.status(200).json({ 
      success: true, 
      id: resultId,
      message: 'Score saved'
    });
    
  } catch (error) {
    console.error('Error saving score:', error);
    return res.status(500).json({ 
      error: 'Internal server error'
    });
  }
};
