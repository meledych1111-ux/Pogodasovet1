import { getTopPlayers } from '../../lib/db.js';

export default async function handler(req, res) {
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительного запроса OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Только GET запросы
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Метод не разрешен'
    });
  }
  
  console.log('🏆 /api/top-players - Request:', req.query);

  try {
    const { gameType = 'tetris', limit = 10, userId } = req.query;
    const numericLimit = Math.min(parseInt(limit) || 10, 100);
    
    // Валидация gameType
    const validGameTypes = ['tetris', 'snake', 'pong', 'racing'];
    if (!validGameTypes.includes(gameType)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный тип игры',
        validGameTypes: validGameTypes
      });
    }
    
    // Получаем топ игроков
    const players = await getTopPlayers(gameType, numericLimit);
    
    console.log(`🏆 Игроков из БД (${gameType}):`, players?.length || 0);
    
    // Проверяем что функция вернула данные
    if (!players) {
      console.error('❌ getTopPlayers вернул null/undefined');
      return res.status(500).json({
        success: false,
        error: 'Ошибка получения данных из базы',
        players: []
      });
    }
    
    // Гарантируем что работаем с массивом
    const playersArray = Array.isArray(players) ? players : [];
    
    // Форматируем для фронтенда
    const formattedPlayers = playersArray.map((player, index) => {
      // Стандартизируем поля
      const playerId = player.user_id || player.userId || player.id || null;
      const playerScore = Number(player.score || player.best_score || player.high_score || 0);
      const playerLevel = Number(player.level || player.best_level || 1);
      const playerLines = Number(player.lines || player.best_lines || 0);
      const gamesPlayed = Number(player.games_played || player.total_games || 1);
      
      // Генерация имени
      let username = player.username || `Игрок ${index + 1}`;
      
      // Если нет username, создаем его на основе ID
      if (!player.username && playerId) {
        const idStr = String(playerId);
        if (idStr.length <= 10) {
          username = `👤 Telegram #${idStr.slice(-4)}`;
        } else {
          username = `🌐 Web #${idStr.slice(-4)}`;
        }
      }
      
      return {
        rank: index + 1,
        user_id: playerId,
        username: username,
        score: playerScore,
        level: playerLevel,
        lines: playerLines,
        games_played: gamesPlayed,
        // Добавляем оригинальные данные для отладки
        _original: {
          id: player.id,
          user_id: player.user_id,
          username: player.username,
          score: player.score
        }
      };
    });
    
    const response = {
      success: true,
      gameType: gameType,
      limit: numericLimit,
      count: formattedPlayers.length,
      players: formattedPlayers,
      timestamp: new Date().toISOString(),
      // Для отладки
      debug: process.env.NODE_ENV === 'development' ? {
        originalCount: playersArray.length,
        query: req.query
      } : undefined
    };
    
    console.log(`✅ Топ игроков (${gameType}): ${formattedPlayers.length} игроков`);
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Критическая ошибка получения топа:', error);
    
    // Возвращаем 500 только для реальных ошибок сервера
    return res.status(500).json({
      success: false,
      players: [],
      error: 'Внутренняя ошибка сервера',
      // Детали ошибки только в development
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
