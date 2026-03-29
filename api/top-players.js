import { getTopPlayers } from '../../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  console.log('🏆 /api/top-players - Request:', req.query);

  try {
    const { gameType = 'tetris', limit = 10, userId } = req.query;
    const numericLimit = Math.min(parseInt(limit) || 10, 100);
    
    // Получаем топ игроков
    const players = await getTopPlayers(gameType, numericLimit);
    
    console.log('🏆 Игроков из БД:', players.length);
    
    // ВАЖНО: Проверяем что это массив
    if (!Array.isArray(players)) {
      console.error('❌ players не массив:', typeof players);
      return res.status(200).json({
        success: true,
        players: [],
        message: 'Нет данных'
      });
    }
    
    // Форматируем для фронтенда
    const formattedPlayers = players.map((player, index) => {
      // player может быть разным форматом
      const playerId = player.user_id || player.userId || player.id;
      const playerScore = player.score || player.best_score || 0;
      
      // Создаем имя игрока
      let username;
      if (player.username) {
        username = player.username;
      } else if (playerId) {
        // Определяем тип игрока
        const isTelegramUser = String(playerId).length <= 10; // Telegram ID обычно до 10 цифр
        const isWebUser = String(playerId).length > 10; // Веб ID длинный
        
        if (isTelegramUser) {
          username = `👤 Telegram #${String(playerId).slice(-4)}`;
        } else if (isWebUser) {
          username = `🌐 Web #${String(playerId).slice(-4)}`;
        } else {
          username = `Игрок #${String(playerId).slice(-4)}`;
        }
      } else {
        username = `Игрок ${index + 1}`;
      }
      
      return {
        rank: index + 1,
        user_id: playerId,
        username: username,
        score: playerScore,
        level: player.level || player.best_level || 1,
        lines: player.lines || player.best_lines || 0,
        games_played: player.games_played || 1
      };
    });
    
    const response = {
      success: true,
      gameType: gameType,
      limit: numericLimit,
      count: formattedPlayers.length,
      players: formattedPlayers, // ГАРАНТИРУЕМ что это массив
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Топ игроков сформирован:', {
      count: response.count,
      isArray: Array.isArray(response.players)
    });
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Ошибка получения топа:', error);
    
    // ВСЕГДА возвращаем массив, даже при ошибке!
    return res.status(200).json({
      success: false,
      players: [], // Пустой массив
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}