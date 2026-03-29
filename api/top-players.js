import { getTopPlayers } from './db.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  console.log('🏆 /api/top-players - Запрос рейтинга');

  try {
    const { gameType = 'tetris', limit = 10 } = req.query;
    const numericLimit = Math.min(parseInt(limit) || 10, 50);
    
    // Получаем топ игроков из нашей базы данных
    const result = await getTopPlayers(gameType, numericLimit);
    
    if (!result.success) {
      return res.status(200).json({
        success: false,
        players: [],
        error: 'Ошибка получения данных из БД'
      });
    }

    // Форматируем данные для фронтенда
    const formattedPlayers = result.players.map((player, index) => ({
      rank: index + 1,
      username: player.display_name || player.username || 'Аноним',
      score: parseInt(player.best_score) || 0,
      city: player.city || 'Не указан',
      level: player.best_level || 1,
      lines: player.best_lines || 0,
      games_played: player.games_played || 1
    }));
    
    return res.status(200).json({
      success: true,
      gameType: gameType,
      count: formattedPlayers.length,
      players: formattedPlayers,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Ошибка в top-players API:', error);
    return res.status(200).json({
      success: false,
      players: [],
      error: error.message
    });
  }
}
