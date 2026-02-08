// Используем абсолютный путь для Vercel
import { getTopPlayers, query } from '/var/task/db.js';

export default async function handler(req, res) {
  console.log('🏆 API: /api/top-players - запрос топа игроков');
  console.log('🏆 Метод:', req.method);
  console.log('🏆 Query параметры:', req.query);
  console.log('🏆 Body параметры:', req.body);
  console.log('🏆 Headers:', req.headers);
  console.log('🏆 URL:', req.url);
  console.log('🏆 Время запроса:', new Date().toISOString());
  
  // ========== ЛОГИКА ДО ПОЛУЧЕНИЯ ТОПА ==========
  
  // Логирование окружения и конфигурации
  console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
  console.log('🔧 Vercel Region:', process.env.VERCEL_REGION);
  console.log('🔧 Runtime:', process.env.VERCEL_RUNTIME);
  
  // Проверка наличия базы данных
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    console.error('❌ DATABASE_URL не настроен в production окружении');
    return res.status(500).json({
      success: false,
      error: 'Database configuration missing',
      message: 'Настройки базы данных не найдены'
    });
  }
  
  // Проверка API ключа (если требуется аутентификация)
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (process.env.REQUIRE_API_KEY === 'true' && !apiKey) {
    console.log('❌ API ключ не предоставлен');
    return res.status(401).json({
      success: false,
      error: 'API key required',
      message: 'Требуется API ключ для доступа'
    });
  }
  
  if (process.env.REQUIRE_API_KEY === 'true' && apiKey !== process.env.API_KEY) {
    console.log('❌ Неверный API ключ');
    return res.status(403).json({
      success: false,
      error: 'Invalid API key',
      message: 'Неверный API ключ'
    });
  }
  
  // Rate limiting - простой вариант
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  console.log('🌐 IP клиента:', clientIp);
  
  // Разрешаем оба метода для удобства
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET or POST.',
      message: 'Метод не разрешен. Используйте GET или POST.',
      allowed_methods: ['GET', 'POST']
    });
  }

  try {
    let gameType, limit, userId, sortBy, order, includeInactive, showBotOwner;
    
    // Получаем параметры в зависимости от метода
    if (req.method === 'GET') {
      gameType = req.query.gameType || req.query.game_type || 'tetris';
      limit = req.query.limit ? parseInt(req.query.limit) : 10;
      userId = req.query.userId || req.query.user_id;
      sortBy = req.query.sortBy || 'score';
      order = req.query.order || 'desc';
      includeInactive = req.query.includeInactive === 'true';
      showBotOwner = req.query.showBotOwner === 'true';
    } else if (req.method === 'POST') {
      gameType = req.body.gameType || req.body.game_type || 'tetris';
      limit = req.body.limit ? parseInt(req.body.limit) : 10;
      userId = req.body.userId || req.body.user_id;
      sortBy = req.body.sortBy || 'score';
      order = req.body.order || 'desc';
      includeInactive = req.body.includeInactive === true;
      showBotOwner = req.body.showBotOwner === true;
    }
    
    console.log('🎮 Параметры запроса топа:', { 
      gameType, 
      limit, 
      userId, 
      sortBy, 
      order, 
      includeInactive,
      showBotOwner
    });
    
    // Валидация параметров
    const validationErrors = [];
    
    // Валидация gameType
    const allowedGameTypes = ['tetris', 'puzzle', 'arcade', 'adventure', 'all'];
    if (!allowedGameTypes.includes(gameType)) {
      validationErrors.push(`Недопустимый тип игры. Допустимые значения: ${allowedGameTypes.join(', ')}`);
      gameType = 'tetris'; // Установка значения по умолчанию
    }
    
    // Валидация лимита
    if (isNaN(limit) || limit < 1) {
      validationErrors.push('Лимит должен быть числом больше 0');
      limit = 10;
    }
    
    if (limit > 100) {
      validationErrors.push('Максимальный лимит - 100 записей');
      limit = 100;
    }
    
    // Валидация userId
    if (userId && isNaN(parseInt(userId))) {
      validationErrors.push('ID пользователя должен быть числом');
      userId = null;
    }
    
    // Валидация sortBy
    const allowedSortFields = ['score', 'level', 'lines', 'games_played', 'last_played'];
    if (!allowedSortFields.includes(sortBy)) {
      validationErrors.push(`Недопустимое поле сортировки. Допустимые значения: ${allowedSortFields.join(', ')}`);
      sortBy = 'score';
    }
    
    // Валидация order
    if (!['asc', 'desc'].includes(order)) {
      validationErrors.push('Порядок сортировки должен быть "asc" или "desc"');
      order = 'desc';
    }
    
    // Логируем ошибки валидации
    if (validationErrors.length > 0) {
      console.warn('⚠️ Ошибки валидации:', validationErrors);
    }
    
    // Проверка кэша запросов
    const cacheKey = `top_players_${gameType}_${limit}_${sortBy}_${order}`;
    console.log('🔑 Ключ кэша:', cacheKey);
    
    // Добавляем задержку для имитации нагрузки (только для тестирования)
    if (req.query.simulateDelay === 'true') {
      console.log('⏳ Имитация задержки 500мс...');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Проверка на ботов и спам
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.includes('bot') || userAgent.includes('spider')) {
      console.log('🤖 Обнаружен бот/краулер:', userAgent);
      // Можно ограничить данные для ботов
      limit = Math.min(limit, 5);
    }
    
    // Логирование полного контекста запроса
    const requestContext = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: clientIp,
      userAgent: userAgent,
      params: { gameType, limit, userId, sortBy, order, includeInactive, showBotOwner },
      validationErrors
    };
    
    console.log('📋 Контекст запроса:', JSON.stringify(requestContext, null, 2));
    
    // Проверка времени суток для нагрузки
    const hour = new Date().getHours();
    if (hour >= 18 || hour <= 8) {
      console.log('🌙 Вечернее/ночное время, возможна высокая нагрузка');
    }
    
    console.log(`🏆 Получение топ ${limit} игроков для игры: ${gameType}, сортировка: ${sortBy} ${order}`);
    
    // Таймер для измерения производительности
    const startTime = Date.now();
    
    // ========== ПОЛУЧЕНИЕ ТОПА ИГРОКОВ ==========
    
    // Получаем топ игроков из базы данных
    const topPlayers = await getTopPlayers(gameType, limit, sortBy, order, includeInactive);
    
    // Если запрошен владелец бота, добавляем его отдельно
    let botOwnerData = null;
    if (showBotOwner) {
      try {
        // ID владельца бота (замените на реальный ID)
        const BOT_OWNER_ID = process.env.BOT_OWNER_ID || 1;
        const result = await query(
          'SELECT * FROM game_stats WHERE user_id = $1 AND game_type = $2',
          [BOT_OWNER_ID, gameType]
        );
        
        if (result.rows.length > 0) {
          botOwnerData = result.rows[0];
          console.log('👑 Владелец бота найден:', {
            id: botOwnerData.user_id,
            score: botOwnerData.score,
            username: botOwnerData.username || `Владелец #${botOwnerData.user_id}`
          });
          
          // Проверяем, есть ли владелец бота в топе
          const isInTop = topPlayers.some(player => player.user_id === BOT_OWNER_ID);
          if (!isInTop) {
            console.log('👑 Владелец бота не в топе, добавляем как дополнительную запись');
          }
        }
      } catch (error) {
        console.error('⚠️ Ошибка при получении данных владельца бота:', error.message);
      }
    }
    
    const endTime = Date.now();
    const executionTime = endTime - startTime;
    
    console.log(`⚡ Время выполнения запроса к БД: ${executionTime}мс`);
    console.log(`🏆 Найдено игроков в топе: ${topPlayers.length}`);
    
    // Проверка качества данных
    if (topPlayers.length > 0) {
      const firstPlayer = topPlayers[0];
      console.log('👑 Лучший игрок:', {
        id: firstPlayer.user_id,
        score: firstPlayer.score,
        level: firstPlayer.level,
        username: firstPlayer.username || `Игрок #${firstPlayer.user_id}`
      });
      
      // Проверка аномалий в данных
      const scores = topPlayers.map(p => p.score || 0);
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      
      if (maxScore > 1000000) {
        console.warn('⚠️ Возможная аномалия: очень высокий счет');
      }
      
      if (minScore < 0) {
        console.error('❌ Ошибка данных: отрицательный счет');
      }
    }
    
    // Если указан userId, находим позицию пользователя
    let userRank = null;
    let userStats = null;
    let userGlobalStats = null;
    
    if (userId) {
      const numericUserId = parseInt(userId);
      if (!isNaN(numericUserId)) {
        userRank = topPlayers.findIndex(player => player.user_id === numericUserId);
        if (userRank !== -1) {
          userStats = topPlayers[userRank];
          console.log(`👤 Пользователь ${numericUserId} на позиции ${userRank + 1} в топе`);
        } else {
          console.log(`👤 Пользователь ${numericUserId} не в топе`);
          
          // Получение статистики пользователя даже если он не в топе
          try {
            const userResult = await query(
              'SELECT * FROM game_stats WHERE user_id = $1 AND game_type = $2',
              [numericUserId, gameType]
            );
            
            if (userResult.rows.length > 0) {
              userGlobalStats = userResult.rows[0];
              console.log(`ℹ️ Статистика пользователя ${numericUserId} получена:`, {
                score: userGlobalStats.score,
                level: userGlobalStats.level
              });
            }
          } catch (error) {
            console.log(`⚠️ Не удалось получить статистику пользователя ${numericUserId}:`, error.message);
          }
        }
      }
    }
    
    // Анализ данных топа
    const analysis = analyzeTopPlayers(topPlayers);
    console.log('📊 Анализ топа:', analysis);
    
    // Форматируем ответ
    const response = {
      success: true,
      gameType: gameType,
      limit: limit,
      count: topPlayers.length,
      timestamp: new Date().toISOString(),
      execution_time_ms: executionTime,
      request_id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      
      // Валидационные предупреждения
      warnings: validationErrors.length > 0 ? validationErrors : undefined,
      
      // Топ игроков (только реальные данные)
      top_players: topPlayers.map((player, index) => ({
        rank: index + 1,
        user_id: player.user_id,
        score: player.score || 0,
        level: player.level || 1,
        lines: player.lines || 0,
        games_played: player.games_played || 0,
        username: player.username || `Игрок #${player.user_id}`,
        telegram_username: player.telegram_username || null,
        avatar_url: player.avatar_url || null,
        medal: getMedalIcon(index + 1),
        formatted_score: formatNumber(player.score || 0),
        is_online: player.last_active ? 
          (Date.now() - new Date(player.last_active).getTime()) < 300000 : // 5 минут
          false,
        is_bot_owner: process.env.BOT_OWNER_ID && player.user_id.toString() === process.env.BOT_OWNER_ID.toString(),
        last_played: player.last_played || null,
        join_date: player.created_at || null,
        is_real_user: true
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
          games_played: userStats.games_played,
          last_played: userStats.last_played,
          join_date: userStats.created_at
        } : userGlobalStats,
        message: userRank !== -1 
          ? `Вы на ${userRank + 1} месте в топе!` 
          : `Вы пока не в топе. Играйте больше!`,
        next_rank_score: userRank !== -1 && userRank > 0 ? 
          topPlayers[userRank - 1].score - userStats.score : 
          topPlayers.length > 0 ? topPlayers[0].score - (userStats?.score || 0) : null,
        is_bot_owner: process.env.BOT_OWNER_ID && parseInt(userId) === parseInt(process.env.BOT_OWNER_ID)
      } : null,
      
      // Данные владельца бота (если запрошены и не в топе)
      bot_owner: showBotOwner && botOwnerData && !topPlayers.some(p => p.user_id === botOwnerData.user_id) ? {
        user_id: botOwnerData.user_id,
        username: botOwnerData.username || 'Владелец бота',
        score: botOwnerData.score || 0,
        level: botOwnerData.level || 1,
        lines: botOwnerData.lines || 0,
        games_played: botOwnerData.games_played || 0,
        formatted_score: formatNumber(botOwnerData.score || 0),
        is_bot_owner: true,
        note: 'Создатель этого бота'
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
          : 0,
        total_games_played: topPlayers.reduce((sum, p) => sum + (p.games_played || 0), 0),
        total_lines_cleared: topPlayers.reduce((sum, p) => sum + (p.lines || 0), 0),
        average_level: topPlayers.length > 0 
          ? (topPlayers.reduce((sum, p) => sum + (p.level || 0), 0) / topPlayers.length).toFixed(1)
          : 0,
        unique_players: new Set(topPlayers.map(p => p.user_id)).size,
        has_bot_owner_in_top: process.env.BOT_OWNER_ID ? 
          topPlayers.some(p => p.user_id.toString() === process.env.BOT_OWNER_ID.toString()) : 
          false
      },
      
      // Анализ данных
      analysis: analysis,
      
      // Мета информация
      meta: {
        cache: true,
        cache_key: cacheKey,
        cache_duration: 60, // секунд
        generated_at: new Date().toISOString(),
        next_update: new Date(Date.now() + 60000).toISOString(),
        version: '1.2.0',
        sort_by: sortBy,
        sort_order: order,
        include_inactive: includeInactive,
        show_bot_owner: showBotOwner,
        data_source: 'real_database',
        disclaimer: 'Все данные взяты из реальной базы данных игроков'
      }
    };
    
    console.log('✅ Топ игроков получен:', {
      top_score: response.leaderboard_stats.top_score,
      total_players: response.leaderboard_stats.total_players,
      unique_players: response.leaderboard_stats.unique_players,
      current_user_in_top: response.current_user?.in_top || false,
      bot_owner_in_top: response.leaderboard_stats.has_bot_owner_in_top,
      execution_time: executionTime + 'ms'
    });
    
    // Установка заголовков кэширования
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    res.setHeader('X-Request-ID', response.request_id);
    res.setHeader('X-Execution-Time', executionTime + 'ms');
    res.setHeader('X-Data-Source', 'real-database');
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения топа игроков:', error);
    console.error('🔥 Stack trace:', error.stack);
    console.error('🔥 Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      sql: error.sql,
      parameters: error.parameters
    });
    
    // Извлекаем userId для фолбэка
    let userId;
    if (req.method === 'GET') {
      userId = req.query.userId || req.query.user_id;
    } else if (req.method === 'POST') {
      userId = req.body.userId || req.body.user_id;
    }
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: error.code || 'LEADERBOARD_ERROR',
        timestamp: new Date().toISOString(),
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        request_id: Date.now().toString(36) + Math.random().toString(36).substr(2)
      },
      fallback_data: {
        top_players: [], // Пустой массив вместо демо-данных
        message: 'Не удалось загрузить топ игроков. База данных недоступна.',
        current_user: userId ? {
          user_id: parseInt(userId),
          in_top: false,
          message: 'Сервис временно недоступен. Попробуйте позже.'
        } : null,
        is_fallback: false // Показываем, что это реальная ошибка
      },
      support_contact: process.env.SUPPORT_EMAIL || 'support@example.com',
      retry_after: 60 // секунд
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

// Функция анализа данных топа
function analyzeTopPlayers(players) {
  if (players.length === 0) {
    return {
      message: 'В топе пока нет игроков',
      status: 'empty'
    };
  }
  
  const scores = players.map(p => p.score || 0);
  const levels = players.map(p => p.level || 1);
  const gamesPlayed = players.map(p => p.games_played || 0);
  
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const scoreRange = maxScore - minScore;
  const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const medianScore = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  
  // Определяем уровень конкуренции
  let competitionLevel = 'низкая';
  if (scoreRange > averageScore * 0.5) competitionLevel = 'высокая';
  else if (scoreRange > averageScore * 0.2) competitionLevel = 'средняя';
  
  // Проверяем активность игроков
  const recentPlayers = players.filter(p => {
    if (!p.last_played) return false;
    const daysSinceLastPlay = (Date.now() - new Date(p.last_played).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceLastPlay < 7; // Играли в последние 7 дней
  });
  
  // Определяем самого активного игрока
  const mostActivePlayer = players.reduce((mostActive, player) => {
    return (player.games_played || 0) > (mostActive.games_played || 0) ? player : mostActive;
  }, players[0]);
  
  // Определяем самого опытного игрока (по уровню)
  const mostExperiencedPlayer = players.reduce((mostExp, player) => {
    return (player.level || 0) > (mostExp.level || 0) ? player : mostExp;
  }, players[0]);
  
  return {
    competition_level: competitionLevel,
    score_range: scoreRange,
    average_score: Math.round(averageScore),
    median_score: medianScore,
    top_score: maxScore,
    lowest_top_score: minScore,
    active_players: recentPlayers.length,
    active_percentage: Math.round((recentPlayers.length / players.length) * 100),
    average_level: (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1),
    total_games_played: gamesPlayed.reduce((a, b) => a + b, 0),
    most_active_player: {
      user_id: mostActivePlayer.user_id,
      username: mostActivePlayer.username || `Игрок #${mostActivePlayer.user_id}`,
      games_played: mostActivePlayer.games_played || 0
    },
    most_experienced_player: {
      user_id: mostExperiencedPlayer.user_id,
      username: mostExperiencedPlayer.username || `Игрок #${mostExperiencedPlayer.user_id}`,
      level: mostExperiencedPlayer.level || 0
    },
    status: 'healthy'
  };
}

// Функция для тестирования API
export const testTopPlayers = async (testLimit = 5) => {
  try {
    console.log(`🧪 Тест топа игроков, лимит: ${testLimit}`);
    const topPlayers = await getTopPlayers('tetris', testLimit);
    console.log(`🧪 Найдено игроков: ${topPlayers.length}`);
    
    if (topPlayers.length > 0) {
      console.log('🧪 Топ игроков:');
      topPlayers.forEach((player, index) => {
        console.log(`${index + 1}. ID: ${player.user_id}, Score: ${player.score}, Username: ${player.username || 'N/A'}`);
      });
    } else {
      console.log('🧪 В базе данных пока нет игроков');
    }
    
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
