import { getTopPlayers } from '../db.js';

export default async function handler(req, res) {
  console.log('🏆 API: /api/top-players - запрос топа игроков');
  console.log('🏆 Метод:', req.method);
  console.log('🏆 Query параметры:', req.query);
  console.log('🏆 Body параметры:', req.body);
  
  // Разрешаем оба метода для удобства
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET or POST.' 
    });
  }

  try {
    let gameType, limit, userId;
    
    // Получаем параметры в зависимости от метода
    if (req.method === 'GET') {
      gameType = req.query.gameType || req.query.game_type || 'tetris';
      limit = req.query.limit ? parseInt(req.query.limit) : 10;
      userId = req.query.userId || req.query.user_id;
    } else if (req.method === 'POST') {
      gameType = req.body.gameType || req.body.game_type || 'tetris';
      limit = req.body.limit ? parseInt(req.body.limit) : 10;
      userId = req.body.userId || req.body.user_id;
    }
    
    console.log('🎮 Параметры запроса топа:', { gameType, limit, userId });
    
    // Валидация лимита
    if (limit < 1 || limit > 100) {
      limit = 10; // Дефолтное значение
      console.log('⚠️ Некорректный лимит, установлен дефолтный:', limit);
    }
    
    console.log(`🏆 Получение топ ${limit} игроков для игры: ${gameType}`);
    
    // Получаем топ игроков из базы данных
    const topPlayers = await getTopPlayers(gameType, limit);
    
    console.log(`🏆 Найдено игроков в топе: ${topPlayers.length}`);
    
    // Если указан userId, находим позицию пользователя
    let userRank = null;
    let userStats = null;
    
    if (userId) {
      const numericUserId = parseInt(userId);
      if (!isNaN(numericUserId)) {
        userRank = topPlayers.findIndex(player => player.user_id === numericUserId);
        if (userRank !== -1) {
          userStats = topPlayers[userRank];
          console.log(`👤 Пользователь ${numericUserId} на позиции ${userRank + 1} в топе`);
        } else {
          console.log(`👤 Пользователь ${numericUserId} не в топе`);
          
          // Можно добавить логику для получения статистики пользователя вне топа
          // const userStats = await getGameStats(numericUserId, gameType);
        }
      }
    }
    
    // Форматируем ответ
    const response = {
      success: true,
      gameType: gameType,
      limit: limit,
      count: topPlayers.length,
      timestamp: new Date().toISOString(),
      
      // Топ игроков
      top_players: topPlayers.map((player, index) => ({
        rank: index + 1,
        user_id: player.user_id,
        score: player.score || 0,
        level: player.level || 1,
        lines: player.lines || 0,
        games_played: player.games_played || 0,
        username: player.username || `Игрок #${player.user_id}`,
        medal: getMedalIcon(index + 1),
        formatted_score: formatNumber(player.score || 0)
      })),
      
      // Информация о текущем пользователе
      current_user: userId ? {
        user_id: parseInt(userId),
        in_top: userRank !== -1,
        rank: userRank !== -1 ? userRank + 1 : null,
        stats: userStats ? {
          score: userStats.score,
          level: userStats.level,
          lines: userStats.lines,
          games_played: userStats.games_played
        } : null,
        message: userRank !== -1 
          ? `Вы на ${userRank + 1} месте в топе!` 
          : `Вы пока не в топе. Играйте больше!`
      } : null,
      
      // Статистика топа
      leaderboard_stats: {
        total_players: topPlayers.length,
        top_score: topPlayers.length > 0 ? topPlayers[0].score : 0,
        average_score: topPlayers.length > 0 
          ? Math.round(topPlayers.reduce((sum, p) => sum + (p.score || 0), 0) / topPlayers.length)
          : 0,
        min_score_for_top: topPlayers.length > 0 
          ? topPlayers[topPlayers.length - 1].score 
          : 0
      },
      
      // Мета информация
      meta: {
        cache: true,
        cache_duration: 60, // секунд
        generated_at: new Date().toISOString(),
        next_update: new Date(Date.now() + 60000).toISOString()
      }
    };
    
    console.log('✅ Топ игроков получен:', {
      top_score: response.leaderboard_stats.top_score,
      total_players: response.leaderboard_stats.total_players,
      current_user_in_top: response.current_user?.in_top || false
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения топа игроков:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'LEADERBOARD_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      fallback_data: {
        top_players: [],
        message: 'Не удалось загрузить топ игроков. Попробуйте позже.',
        current_user: userId ? {
          user_id: parseInt(userId),
          in_top: false,
          message: 'Статистика временно недоступна'
        } : null
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Вспомогательная функция для получения иконки медали
function getMedalIcon(rank) {
  switch(rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    case 4: case 5: case 6: case 7: case 8: case 9: case 10:
      return '⭐';
    default:
      return '🔸';
  }
}

// Вспомогательная функция для форматирования чисел
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Функция для тестирования API
export const testTopPlayers = async (testLimit = 5) => {
  try {
    console.log(`🧪 Тест топа игроков, лимит: ${testLimit}`);
    const topPlayers = await getTopPlayers('tetris', testLimit);
    console.log(`🧪 Найдено игроков: ${topPlayers.length}`);
    console.log('🧪 Топ игроков:', topPlayers);
    return topPlayers;
  } catch (error) {
    console.error('🧪 Ошибка теста:', error);
    return null;
  }
};

// Если файл запущен напрямую, выполнить тест
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Запуск теста top-players.js');
  testTopPlayers().then(() => {
    console.log('🧪 Тест завершен');
    process.exit(0);
  });
}
