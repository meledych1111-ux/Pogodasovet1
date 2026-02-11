import { getGameStats } from './db.js';
import { pool } from './db.js';

export default async function handler(req, res) {
  console.log('📊 API: /api/user-stats - запрос статистики пользователя');
  
  // Разрешаем оба метода для удобства
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET or POST.' 
    });
  }

  try {
    let telegramId, gameType;
    
    // 🔴 БЕРЕМ ТОЛЬКО TELEGRAM ID! ВСЁ ОСТАЛЬНОЕ ИГНОРИРУЕМ!
    if (req.method === 'GET') {
      telegramId = req.query.telegramId || req.query.userId;
      gameType = req.query.gameType || req.query.game_type || 'tetris';
    } else if (req.method === 'POST') {
      telegramId = req.body.telegramId || req.body.userId;
      gameType = req.body.gameType || req.body.game_type || 'tetris';
    }
    
    console.log('👤 Извлеченные параметры:', { telegramId, gameType });
    
    // Валидация данных
    if (!telegramId) {
      console.log('❌ Отсутствует telegramId');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameter: telegramId',
        code: 'MISSING_TELEGRAM_ID'
      });
    }
    
    // 🔴 ОЧИЩАЕМ ID - ТОЛЬКО ЦИФРЫ!
    const cleanTelegramId = String(telegramId).replace(/[^0-9]/g, '');
    
    if (!cleanTelegramId) {
      console.log('❌ Некорректный telegramId:', telegramId);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid telegramId format',
        code: 'INVALID_TELEGRAM_ID'
      });
    }
    
    console.log(`📊 Получение статистики для пользователя ${cleanTelegramId}, игра: ${gameType}`);
    
    const client = await pool.connect();
    
    try {
      // 1️⃣ ПОЛУЧАЕМ ГОРОД ИЗ ТАБЛИЦЫ users (по Telegram ID)
      let city = 'Не указан';
      let username = 'Игрок';
      
      const userResult = await client.query(
        'SELECT city, username, first_name FROM users WHERE user_id = $1',
        [cleanTelegramId]
      );
      
      if (userResult.rows.length > 0) {
        city = userResult.rows[0].city || 'Не указан';
        username = userResult.rows[0].username || 
                  userResult.rows[0].first_name || 
                  `Игрок ${cleanTelegramId.slice(-4)}`;
        console.log(`🏙️ Найден город из users: "${city}"`);
      }
      
      // 2️⃣ ПОЛУЧАЕМ СТАТИСТИКУ ИЗ game_scores - ТОЛЬКО ПО TELEGRAM ID!
      const statsQuery = `
        SELECT 
          COUNT(*) as games_played,
          COALESCE(MAX(score), 0) as best_score,
          COALESCE(MAX(level), 1) as best_level,
          COALESCE(MAX(lines), 0) as best_lines,
          COALESCE(AVG(score), 0) as avg_score,
          COALESCE(SUM(score), 0) as total_score,
          MAX(created_at) as last_played,
          COUNT(CASE WHEN is_win = true THEN 1 END) as wins,
          COUNT(CASE WHEN is_win = false THEN 1 END) as losses
        FROM game_scores 
        WHERE user_id = $1 
          AND game_type = $2
          AND score > 0
      `;
      
      const statsResult = await client.query(statsQuery, [cleanTelegramId, gameType]);
      const stats = statsResult.rows[0] || {};
      
      const gamesPlayed = parseInt(stats.games_played) || 0;
      const bestScore = parseInt(stats.best_score) || 0;
      const wins = parseInt(stats.wins) || 0;
      const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) : 0;
      
      console.log(`🎮 Статистика из game_scores:`, {
        games_played: gamesPlayed,
        best_score: bestScore,
        user_id: cleanTelegramId
      });
      
      // 3️⃣ ПРОВЕРЯЕМ НЕЗАВЕРШЕННУЮ ИГРУ
      let hasUnfinishedGame = false;
      let currentProgress = null;
      
      try {
        const progressQuery = `
          SELECT score, level, lines, last_saved 
          FROM game_progress 
          WHERE user_id = $1 AND game_type = $2
        `;
        
        const progressResult = await client.query(progressQuery, [cleanTelegramId, gameType]);
        
        if (progressResult.rows.length > 0) {
          hasUnfinishedGame = true;
          currentProgress = progressResult.rows[0];
          console.log(`🎮 Найден незавершенный прогресс для ${cleanTelegramId}`);
        }
      } catch (error) {
        console.error('Ошибка получения прогресса:', error);
      }
      
      // 4️⃣ ФОРМИРУЕМ ОТВЕТ - ТОЛЬКО TELEGRAM ID!
      const response = {
        success: true,
        telegramId: cleanTelegramId,
        userId: cleanTelegramId, // 🔴 ВАЖНО: userId = telegramId!
        gameType: gameType,
        timestamp: new Date().toISOString(),
        isWebApp: false,
        
        // 🔴 ГОРОД ИЗ users
        city: city,
        username: username,
        city_source: userResult.rows.length > 0 ? 'users_table' : 'none',
        
        // 🔴 СТАТИСТИКА ИЗ game_scores
        stats: {
          games_played: gamesPlayed,
          best_score: bestScore,
          best_level: parseInt(stats.best_level) || 1,
          best_lines: parseInt(stats.best_lines) || 0,
          avg_score: stats.avg_score ? Math.round(parseFloat(stats.avg_score)) : 0,
          total_score: parseInt(stats.total_score) || 0,
          last_played: stats.last_played || null,
          wins: wins,
          losses: parseInt(stats.losses) || 0,
          win_rate: winRate
        },
        
        // 🔴 ПРОГРЕСС ТЕКУЩЕЙ ИГРЫ
        current_progress: currentProgress ? {
          score: parseInt(currentProgress.score) || 0,
          level: parseInt(currentProgress.level) || 1,
          lines: parseInt(currentProgress.lines) || 0,
          last_saved: currentProgress.last_saved || null,
          has_unfinished_game: true
        } : null,
        
        has_unfinished_game: hasUnfinishedGame,
        
        // 🔴 МЕТА-ИНФОРМАЦИЯ
        meta: {
          has_played: gamesPlayed > 0,
          has_unfinished_game: hasUnfinishedGame,
          has_city: city !== 'Не указан',
          next_milestone: calculateNextMilestone(bestScore),
          player_level: calculatePlayerLevel(gamesPlayed)
        }
      };
      
      console.log('✅ ИТОГОВЫЙ ОТВЕТ:');
      console.log(`   🆔 ID: ${response.telegramId}`);
      console.log(`   🏙️ Город: ${response.city}`);
      console.log(`   👤 Имя: ${response.username}`);
      console.log(`   🎮 Игр: ${response.stats.games_played}`);
      console.log(`   🏆 Рекорд: ${response.stats.best_score}`);
      
      return res.status(200).json(response);
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка получения статистики:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        code: 'DATABASE_ERROR',
        timestamp: new Date().toISOString()
      },
      fallback: {
        city: 'Не указан',
        username: 'Игрок',
        stats: {
          games_played: 0,
          best_score: 0,
          best_level: 1,
          best_lines: 0,
          avg_score: 0,
          wins: 0,
          losses: 0,
          win_rate: 0
        }
      }
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Вспомогательная функция для расчета следующего рубежа
function calculateNextMilestone(currentScore) {
  const milestones = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  
  for (const milestone of milestones) {
    if (currentScore < milestone) {
      return {
        target: milestone,
        needed: milestone - currentScore,
        progress: ((currentScore / milestone) * 100).toFixed(1) + '%',
        message: `Следующий рубеж: ${milestone} очков`
      };
    }
  }
  
  return {
    target: 100000,
    needed: 0,
    progress: '100%',
    message: 'Вы достигли максимального рубежа! 🏆'
  };
}

// Вспомогательная функция для расчета уровня игрока
function calculatePlayerLevel(gamesPlayed) {
  if (gamesPlayed === 0) return 'Новичок';
  if (gamesPlayed < 5) return 'Начинающий';
  if (gamesPlayed < 15) return 'Любитель';
  if (gamesPlayed < 30) return 'Опытный';
  if (gamesPlayed < 50) return 'Профессионал';
  if (gamesPlayed < 100) return 'Эксперт';
  return 'Мастер';
}
