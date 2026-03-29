import { getTopPlayers, getGameStats } from './db.js';

export default async function handler(req, res) {
  console.log('🏆 API: /api/top-players - запрос топа игроков');
  
  // Устанавливаем заголовки CORS для разрешения запросов от веб-приложений
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительных OPTIONS запросов
  if (req.method === 'OPTIONS') {
    console.log('📦 Обработка OPTIONS запроса');
    return res.status(200).end();
  }
  
  // Разрешаем оба метода для удобства
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET, POST or OPTIONS.',
      code: 'METHOD_NOT_ALLOWED',
      allowed_methods: ['GET', 'POST', 'OPTIONS']
    });
  }

  try {
    let gameType, limit, userId, includeStats;
    
    // Получаем параметры в зависимости от метода
    if (req.method === 'GET') {
      gameType = req.query.gameType || req.query.game_type || 'tetris';
      limit = req.query.limit ? parseInt(req.query.limit) : 10;
      userId = req.query.userId || req.query.user_id;
      includeStats = req.query.includeStats === 'true';
      
      console.log('📥 GET параметры:', { 
        gameType, limit, userId, includeStats,
        query: req.query 
      });
    } else if (req.method === 'POST') {
      // Пытаемся парсить JSON тело
      let body = req.body;
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch (e) {
          console.log('⚠️ Тело запроса не JSON, используем как есть');
        }
      }
      gameType = body?.gameType || body?.game_type || 'tetris';
      limit = body?.limit ? parseInt(body.limit) : 10;
      userId = body?.userId || body?.user_id;
      includeStats = body?.includeStats || false;
      
      console.log('📥 POST параметры:', { 
        gameType, limit, userId, includeStats,
        bodyType: typeof req.body 
      });
    }
    
    console.log('🎮 Параметры запроса топа:', { gameType, limit, userId, includeStats });
    
    // Валидация лимита
    if (isNaN(limit) || limit < 1) {
      console.log('⚠️ Некорректный лимит, установлен дефолтный: 10');
      limit = 10;
    }
    
    if (limit > 100) {
      console.log('⚠️ Лимит слишком большой, ограничиваю до 100');
      limit = 100;
    }
    
    console.log(`🏆 Получение топ ${limit} игроков для игры: ${gameType}`);
    
    // Получаем топ игроков из базы данных
    const topPlayers = await getTopPlayers(gameType, limit);
    
    console.log(`🏆 Найдено игроков в топе: ${topPlayers.length}`);
    
    // Если нужно получить полную статистику для каждого игрока
    let enhancedPlayers = topPlayers;
    if (includeStats && topPlayers.length > 0) {
      console.log('📊 Получение полной статистики для игроков...');
      
      // Для каждого игрока получаем полную статистику
      enhancedPlayers = await Promise.all(
        topPlayers.map(async (player) => {
          try {
            const playerStats = await getGameStats(player.user_id, gameType);
            return {
              ...player,
              stats: {
                games_played: playerStats?.games_played || 0,
                best_score: playerStats?.best_score || 0,
                best_level: playerStats?.best_level || 1,
                best_lines: playerStats?.best_lines || 0,
                avg_score: playerStats?.avg_score ? Math.round(playerStats.avg_score) : 0
              }
            };
          } catch (error) {
            console.error(`❌ Ошибка получения статистики для игрока ${player.user_id}:`, error.message);
            return player;
          }
        })
      );
    }
    
    // Если указан userId, находим позицию пользователя
    let userRank = null;
    let userStats = null;
    let userGlobalStats = null;
    
    if (userId) {
      const numericUserId = parseUserId(userId);
      if (!isNaN(numericUserId)) {
        // Ищем пользователя в топе
        userRank = enhancedPlayers.findIndex(player => 
          player.user_id === numericUserId || player.dbUserId === numericUserId
        );
        
        if (userRank !== -1) {
          userStats = enhancedPlayers[userRank];
          console.log(`👤 Пользователь ${numericUserId} на позиции ${userRank + 1} в топе`);
        } else {
          console.log(`👤 Пользователь ${numericUserId} не в топе`);
          
          // Получаем статистику пользователя, даже если его нет в топе
          try {
            userGlobalStats = await getGameStats(numericUserId, gameType);
            console.log(`📊 Статистика пользователя ${numericUserId}:`, userGlobalStats);
          } catch (error) {
            console.error(`❌ Ошибка получения статистики пользователя ${numericUserId}:`, error.message);
          }
        }
      }
    }
    
    // Рассчитываем общую статистику топа
    const leaderboardStats = calculateLeaderboardStats(enhancedPlayers);
    
    // Форматируем ответ
    const response = {
      success: true,
      gameType: gameType,
      limit: limit,
      count: enhancedPlayers.length,
      timestamp: new Date().toISOString(),
      requestMethod: req.method,
      includeStats: includeStats,
      
      // Топ игроков
      top_players: enhancedPlayers.map((player, index) => ({
        rank: index + 1,
        user_id: player.user_id,
        dbUserId: player.dbUserId || player.user_id,
        score: player.score || 0,
        level: player.level || 1,
        lines: player.lines || 0,
        games_played: player.games_played || (player.stats?.games_played || 0),
        game_date: player.game_date || null,
        game_time: player.game_time || null,
        medal: getMedalIcon(index + 1),
        emoji: getRankEmoji(index + 1),
        formatted_score: formatNumber(player.score || 0),
        score_formatted: `${formatNumber(player.score || 0)} очков`,
        level_formatted: `${player.level || 1} уровень`,
        lines_formatted: `${player.lines || 0} линий`,
        
        // Дополнительная статистика (если запрошена)
        stats: includeStats ? (player.stats || {
          games_played: 0,
          best_score: player.score || 0,
          best_level: player.level || 1,
          best_lines: player.lines || 0,
          avg_score: 0
        }) : undefined
      })),
      
      // Информация о текущем пользователе
      current_user: userId ? {
        user_id: userId,
        dbUserId: parseUserId(userId),
        in_top: userRank !== -1,
        rank: userRank !== -1 ? userRank + 1 : null,
        medal: userRank !== -1 ? getMedalIcon(userRank + 1) : null,
        stats: userStats ? {
          score: userStats.score,
          level: userStats.level,
          lines: userStats.lines,
          games_played: userStats.games_played || (userStats.stats?.games_played || 0),
          game_date: userStats.game_date
        } : (userGlobalStats ? {
          best_score: userGlobalStats.best_score || 0,
          best_level: userGlobalStats.best_level || 1,
          best_lines: userGlobalStats.best_lines || 0,
          games_played: userGlobalStats.games_played || 0,
          avg_score: userGlobalStats.avg_score || 0
        } : null),
        global_stats: userGlobalStats || null,
        message: getRankMessage(userRank, enhancedPlayers.length, userGlobalStats?.best_score || 0)
      } : null,
      
      // Статистика топа
      leaderboard_stats: leaderboardStats,
      
      // Мета информация
      meta: {
        cache: true,
        cache_duration: 300, // 5 минут в секундах
        generated_at: new Date().toISOString(),
        next_update: new Date(Date.now() + 300000).toISOString(), // 5 минут
        source: 'database',
        version: '2.0'
      },
      
      // Пагинация (для будущего использования)
      pagination: {
        current: 1,
        total: 1,
        has_more: false,
        next_page: null
      },
      
      // Для отладки
      debug: process.env.NODE_ENV === 'development' ? {
        request_details: {
          method: req.method,
          query: req.query,
          body: req.body,
          headers: req.headers
        },
        raw_data_count: enhancedPlayers.length,
        user_lookup: userId ? {
          searched_id: parseUserId(userId),
          found: userRank !== -1,
          rank: userRank
        } : null
      } : undefined
    };
    
    console.log('✅ Топ игроков получен:', {
      top_score: response.leaderboard_stats.top_score,
      top_score_formatted: response.leaderboard_stats.top_score_formatted,
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
        endpoint: '/api/top-players',
        request_method: req.method,
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          fullError: error.toString()
        } : undefined
      },
      fallback_data: {
        top_players: generateFallbackLeaderboard(),
        message: 'Не удалось загрузить топ игроков. Используются демо-данные.',
        current_user: userId ? {
          user_id: userId,
          in_top: false,
          message: 'Статистика временно недоступна',
          fallback: true
        } : null,
        is_fallback: true
      },
      help: {
        example_requests: [
          'GET /api/top-players?gameType=tetris&limit=10',
          'POST /api/top-players with JSON: {"gameType": "tetris", "limit": 10}',
          'GET /api/top-players?userId=123456&includeStats=true'
        ],
        contact: 'Если проблема сохраняется, проверьте подключение к базе данных'
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Вспомогательная функция для парсинга User ID
function parseUserId(userId) {
  if (typeof userId === 'string' && userId.startsWith('web_')) {
    // Извлекаем числовую часть из web_*
    const webIdStr = userId.replace('web_', '');
    const numericId = parseInt(webIdStr);
    return isNaN(numericId) ? hashString(userId) : numericId;
  }
  
  const numericId = parseInt(userId);
  return isNaN(numericId) ? 0 : numericId;
}

// Вспомогательная функция для получения иконки медали
function getMedalIcon(rank) {
  switch(rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    case 4: case 5: return '🏅';
    case 6: case 7: case 8: case 9: case 10:
      return '⭐';
    default:
      return '🔹';
  }
}

// Вспомогательная функция для получения эмодзи ранга
function getRankEmoji(rank) {
  if (rank === 1) return '👑';
  if (rank <= 3) return '🔥';
  if (rank <= 10) return '⭐';
  if (rank <= 20) return '⚡';
  if (rank <= 50) return '💫';
  return '🎯';
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

// Функция для расчета статистики лидерборда
function calculateLeaderboardStats(players) {
  if (players.length === 0) {
    return {
      total_players: 0,
      top_score: 0,
      top_score_formatted: '0',
      average_score: 0,
      average_score_formatted: '0',
      min_score_for_top: 0,
      min_score_formatted: '0',
      total_games_played: 0,
      average_level: 0,
      average_lines: 0,
      score_range: '0-0',
      competition_level: 'Низкая'
    };
  }
  
  const scores = players.map(p => p.score || 0);
  const levels = players.map(p => p.level || 1);
  const lines = players.map(p => p.lines || 0);
  const gamesPlayed = players.map(p => p.games_played || 0);
  
  const totalGames = gamesPlayed.reduce((sum, games) => sum + games, 0);
  const totalScore = scores.reduce((sum, score) => sum + score, 0);
  const avgScore = Math.round(totalScore / players.length);
  const avgLevel = Math.round(levels.reduce((sum, level) => sum + level, 0) / players.length);
  const avgLines = Math.round(lines.reduce((sum, line) => sum + line, 0) / players.length);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  
  // Определяем уровень конкуренции
  let competitionLevel = 'Низкая';
  const scoreRange = maxScore - minScore;
  
  if (scoreRange > 10000) competitionLevel = 'Очень высокая';
  else if (scoreRange > 5000) competitionLevel = 'Высокая';
  else if (scoreRange > 1000) competitionLevel = 'Средняя';
  else if (scoreRange > 100) competitionLevel = 'Низкая';
  else competitionLevel = 'Очень низкая';
  
  return {
    total_players: players.length,
    top_score: maxScore,
    top_score_formatted: formatNumber(maxScore),
    average_score: avgScore,
    average_score_formatted: formatNumber(avgScore),
    min_score_for_top: minScore,
    min_score_formatted: formatNumber(minScore),
    total_games_played: totalGames,
    average_level: avgLevel,
    average_lines: avgLines,
    score_range: `${formatNumber(minScore)}-${formatNumber(maxScore)}`,
    competition_level: competitionLevel,
    score_range_value: scoreRange
  };
}

// Функция для получения сообщения о ранге
function getRankMessage(rank, totalPlayers, userBestScore) {
  if (rank === -1 || rank === null) {
    if (userBestScore === 0) {
      return 'Вы еще не играли. Начните играть, чтобы попасть в топ!';
    }
    return `Ваш лучший счет: ${formatNumber(userBestScore)} очков. Играйте больше, чтобы попасть в топ!`;
  }
  
  const position = rank + 1;
  
  if (position === 1) {
    return '🎉 Вы лидер! Поздравляем с первым местом! 🏆';
  } else if (position <= 3) {
    return `🔥 Вы в топ-3! Отличный результат на ${position} месте!`;
  } else if (position <= 10) {
    return `⭐ Вы в топ-10 на ${position} месте! Продолжайте в том же духе!`;
  } else if (position <= 50) {
    return `⚡ Вы на ${position} месте из ${totalPlayers}. Хорошая работа!`;
  } else {
    return `🎯 Вы на ${position} месте. Есть куда расти!`;
  }
}

// Функция для генерации демо-данных при ошибке БД
function generateFallbackLeaderboard() {
  const demoPlayers = [];
  const names = ['Алексей', 'Мария', 'Дмитрий', 'Анна', 'Сергей', 'Елена', 'Иван', 'Ольга', 'Максим', 'Наталья'];
  
  for (let i = 0; i < 10; i++) {
    const score = 10000 - (i * 800);
    const level = Math.min(20, 5 + i * 2);
    const lines = 50 + i * 10;
    const gamesPlayed = 10 + i * 3;
    
    demoPlayers.push({
      rank: i + 1,
      user_id: 1000 + i,
      username: `${names[i % names.length]}${i > 4 ? i : ''}`,
      score: score,
      level: level,
      lines: lines,
      games_played: gamesPlayed,
      medal: getMedalIcon(i + 1),
      formatted_score: formatNumber(score),
      score_formatted: `${formatNumber(score)} очков`,
      level_formatted: `${level} уровень`,
      lines_formatted: `${lines} линий`,
      is_demo: true
    });
  }
  
  return demoPlayers;
}

// Хэш-функция для строк (для Web App ID)
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Экспортируем вспомогательные функции для тестов
export { 
  parseUserId, 
  getMedalIcon, 
  formatNumber, 
  calculateLeaderboardStats,
  getRankMessage 
};
