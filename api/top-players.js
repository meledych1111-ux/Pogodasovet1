import { getTopPlayers } from './db.js';

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
    
    // Получаем топ игроков - функция возвращает объект {success, players, count, source}
    const result = await getTopPlayers(gameType, numericLimit);
    
    console.log(`🏆 Результат из БД (${gameType}):`, result?.success, 'игроков:', result?.players?.length || 0);
    
    // Проверяем успешность выполнения
    if (!result || !result.success) {
      console.error('❌ Ошибка getTopPlayers:', result?.error);
      return res.status(500).json({
        success: false,
        error: result?.error || 'Ошибка получения данных из базы',
        players: []
      });
    }
    
    // Получаем массив игроков из результата
    const playersArray = Array.isArray(result.players) ? result.players : [];
    
    console.log(`🏆 Подготовлено для отправки ${playersArray.length} игроков`);
    
    // Форматируем для фронтенда
    const formattedPlayers = playersArray.map((player, index) => {
      // Стандартизируем поля
      const playerId = player.user_id || player.userId || player.id || null;
      const playerScore = Number(player.score || player.best_score || player.high_score || 0);
      const playerLevel = Number(player.level || player.best_level || 1);
      const playerLines = Number(player.lines || player.best_lines || 0);
      const gamesPlayed = Number(player.games_played || player.total_games || 1);
      
      // Используем username из результата (уже отформатирован в db.js)
      let username = player.username || `Игрок ${index + 1}`;
      
      // 🔴 УБИРАЕМ пересоздание username - он уже отформатирован в getTopPlayers
      
      return {
        rank: index + 1,
        user_id: playerId,
        username: username,
        score: playerScore,
        level: playerLevel,
        lines: playerLines,
        games_played: gamesPlayed,
        city: player.city || '🏙️ Не указан',
        win_rate: player.win_rate || '0.0',
        last_played: player.last_played || null,
        // Для отладки
        _original: {
          username: player.username,
          city: player.city,
          source: player.source
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
      source: result.source || 'unknown',
      // Для отладки
      debug: process.env.NODE_ENV === 'development' ? {
        resultKeys: Object.keys(result),
        originalCount: result.count,
        query: req.query
      } : undefined
    };
    
    console.log(`✅ Топ игроков (${gameType}): ${formattedPlayers.length} игроков, источник: ${result.source}`);
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Критическая ошибка получения топа:', error);
    
    return res.status(500).json({
      success: false,
      players: [],
      error: 'Внутренняя ошибка сервера',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
