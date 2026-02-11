import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from './db.js';
import { pool } from './db.js'; // Добавляем pool для сохранения связи

function getAchievements(score, level, lines, previousBestScore) {
  const achievements = [];
  
  // Достижения по очкам
  if (score >= 50000) {
    achievements.push({
      title: '🏆 Легенда Тетриса',
      message: '50,000 очков! Ты в пантеоне легенд!',
      type: 'legendary',
      badge: '🏆'
    });
  } else if (score >= 25000) {
    achievements.push({
      title: '🥇 Мастер Игры',
      message: '25,000 очков! Невероятный результат!',
      type: 'master',
      badge: '🥇'
    });
  } else if (score >= 10000) {
    achievements.push({
      title: '🥈 Эксперт Тетриса',
      message: '10,000 очков! Ты в топе игроков!',
      type: 'expert',
      badge: '🥈'
    });
  } else if (score >= 5000) {
    achievements.push({
      title: '🥉 Продвинутый Игрок',
      message: '5,000 очков! Отличный результат!',
      type: 'advanced',
      badge: '🥉'
    });
  } else if (score >= 1000) {
    achievements.push({
      title: '⭐ Начинающий Профи',
      message: '1,000 очков! Хороший старт!',
      type: 'beginner',
      badge: '⭐'
    });
  }
  
  // Достижения по уровню
  if (level >= 20) {
    achievements.push({
      title: '🚀 Сверхзвуковой Уровень',
      message: `Уровень ${level}! Невероятная скорость!`,
      type: 'speed',
      badge: '🚀'
    });
  } else if (level >= 15) {
    achievements.push({
      title: '⚡ Высокая Сложность',
      message: `Уровень ${level}! Ты справляешься!`,
      type: 'hard',
      badge: '⚡'
    });
  } else if (level >= 10) {
    achievements.push({
      title: '🎯 Профессиональный Уровень',
      message: `Уровень ${level}! Отличный прогресс!`,
      type: 'pro',
      badge: '🎯'
    });
  }
  
  // Достижения по линиям
  if (lines >= 100) {
    achievements.push({
      title: '🧱 Строитель Монолит',
      message: `${lines} линий! Фундаментальная работа!`,
      type: 'builder',
      badge: '🧱'
    });
  } else if (lines >= 50) {
    achievements.push({
      title: '🔨 Мастер Сборки',
      message: `${lines} линий! Отличная сборка!`,
      type: 'assembler',
      badge: '🔨'
    });
  } else if (lines >= 25) {
    achievements.push({
      title: '🧩 Умелый Сборщик',
      message: `${lines} линий! Хорошая работа!`,
      type: 'skillful',
      badge: '🧩'
    });
  }
  
  // Новый рекорд
  if (previousBestScore > 0 && score > previousBestScore) {
    const improvement = score - previousBestScore;
    achievements.push({
      title: '📈 Новый Рекорд!',
      message: `Побит предыдущий рекорд на ${improvement} очков!`,
      type: 'record',
      badge: '📈'
    });
  }
  
  return achievements;
}

function generateTips(score, level, lines, isNewRecord) {
  const tips = [];
  
  if (score < 1000) {
    tips.push('💡 Совет: Старайтесь собирать по 4 линии за раз для бонуса x4!');
    tips.push('💡 Совет: Используйте клавиши ← → ↓ и пробел для быстрого падения!');
  } else if (score < 5000) {
    tips.push('💡 Совет: Планируйте расположение фигур на 2-3 шага вперед!');
    tips.push('💡 Совет: Не оставляйте "дырок" - они усложняют игру на высоких уровнях!');
  } else if (score < 10000) {
    tips.push('💡 Про-совет: Сохраняйте I-фигуры (палочки) для очистки 4 линий!');
    tips.push('💡 Про-совет: На высоких уровнях используйте быстрый дроп (пробел) чаще!');
  }
  
  if (level < 5) {
    tips.push('🎯 Цель: Достигните 5 уровня для получения бронзовой медали!');
  } else if (level < 10) {
    tips.push('🎯 Цель: 10 уровень откроет серебряную медаль!');
  }
  
  if (isNewRecord) {
    tips.push('🔥 Отлично! Продолжайте в том же духе!');
  }
  
  return tips.slice(0, 3);
}

export default async function handler(req, res) {
  console.log('📨 POST /api/save-score');
  console.log('📊 Метод:', req.method);
  console.log('📊 Content-Type:', req.headers['content-type']);
  
  if (req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  try {
    let body;
    
    // Парсим тело запроса
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
        console.log('✅ Тело распарсено как JSON');
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON, используем raw body:', req.body);
        body = req.body;
      }
    } else if (req.body) {
      body = req.body;
      console.log('✅ Тело уже объект');
    } else {
      console.log('⚠️ Тело запроса пустое');
      body = {};
    }
    
    console.log('📊 Полное тело запроса:', JSON.stringify(body, null, 2));
    
    // Извлекаем поля
    const {
      // 🔴 ОСНОВНЫЕ ПОЛЯ - только реальные ID!
      userId,        // Telegram ID (975501399) или веб-ID (1770803251747)
      telegramId,    // Telegram ID (975501399) - приоритет!
      webGameId,     // Веб-ID (1770803251747)
      score,
      level = 1,
      lines = 0,
      gameType = 'tetris',
      game_type,
      gameOver = false,
      isGameOver,
      action,
      username,
      first_name,
      last_name,
      data,
      webAppData
    } = body;
    
    console.log('📊 Извлеченные поля:', {
      userId,
      telegramId,
      webGameId,
      score,
      level,
      lines,
      gameType,
      gameOver,
      username
    });
    
    // 🔴 ВАЖНО: Определяем ID по приоритету:
    // 1. telegramId (реальный ID пользователя из бота) - 975501399
    // 2. userId (может быть как Telegram, так и веб-ID)
    // 3. webGameId (веб-ID) - 1770803251747
    
    let finalTelegramId = null;
    let finalWebGameId = null;
    
    // Приоритет 1: telegramId
    if (telegramId) {
      finalTelegramId = String(telegramId).replace(/[^0-9]/g, ''); // Только цифры
      console.log(`✅ Используем Telegram ID: ${finalTelegramId}`);
    }
    
    // Приоритет 2: userId
    if (userId) {
      const cleanUserId = String(userId).replace(/^(web_|test_user_)/, ''); // Убираем префиксы
      if (/^\d+$/.test(cleanUserId)) {
        // Если это числовой ID - это может быть Telegram ID
        if (!finalTelegramId) {
          finalTelegramId = cleanUserId;
          console.log(`✅ Используем userId как Telegram ID: ${finalTelegramId}`);
        }
      } else {
        // Нечисловой ID - веб-ID
        finalWebGameId = cleanUserId;
        console.log(`✅ Используем userId как веб-ID: ${finalWebGameId}`);
      }
    }
    
    // Приоритет 3: webGameId
    if (webGameId) {
      finalWebGameId = String(webGameId).replace(/^(web_|test_user_)/, ''); // Убираем префиксы
      console.log(`✅ Используем webGameId: ${finalWebGameId}`);
    }
    
    // 🔴 Если нет Telegram ID, но есть веб-ID - проверяем связи
    if (!finalTelegramId && finalWebGameId) {
      try {
        const linkResult = await pool.query(
          'SELECT telegram_id FROM user_links WHERE web_game_id = $1',
          [finalWebGameId]
        );
        if (linkResult.rows.length > 0) {
          finalTelegramId = linkResult.rows[0].telegram_id;
          console.log(`🔗 Найдена связь: веб-ID ${finalWebGameId} -> Telegram ID ${finalTelegramId}`);
        }
      } catch (error) {
        console.error('Ошибка поиска связи:', error);
      }
    }
    
    // 🔴 Если нет веб-ID, но есть Telegram ID - создаем веб-ID
    if (!finalWebGameId && finalTelegramId) {
      finalWebGameId = finalTelegramId; // Используем Telegram ID как веб-ID
      console.log(`🆔 Создан веб-ID из Telegram ID: ${finalWebGameId}`);
    }
    
    // Если ID не найден
    if (!finalTelegramId && !finalWebGameId) {
      console.log('❌ Не найден ни один ID');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing user ID',
        received_data: body
      });
    }
    
    // 🔴 Для сохранения игры используем ТОЛЬКО числовой ID (без префиксов!)
    const gameUserId = finalWebGameId || finalTelegramId;
    
    // Определяем gameType
    let finalGameType = gameType;
    if (game_type) finalGameType = game_type;
    
    // Определяем окончание игры
    let finalGameOver = gameOver;
    if (isGameOver !== undefined) finalGameOver = isGameOver;
    if (action === 'tetris_final_score') finalGameOver = true;
    
    // Определяем имя пользователя
    let finalUsername = username || first_name || `Игрок ${gameUserId.slice(-4)}`;
    if (last_name && first_name) {
      finalUsername = `${first_name} ${last_name}`;
    }
    
    // Валидация score
    if (score === undefined || score === null) {
      console.log('❌ Отсутствует score');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing score field' 
      });
    }
    
    // Преобразуем значения
    const numericScore = parseInt(score) || 0;
    const numericLevel = parseInt(level) || 1;
    const numericLines = parseInt(lines) || 0;
    const isWin = numericScore > 0;
    
    console.log('📊 Финальные данные для сохранения:', {
      gameUserId,           // Числовой ID для game_scores
      finalTelegramId,      // Telegram ID для users
      finalWebGameId,       // Веб-ID для связей
      finalUsername,
      numericScore,
      numericLevel,
      numericLines,
      finalGameType,
      finalGameOver,
      isWin
    });
    
    let resultId;
    
    if (finalGameOver) {
      // Сохраняем финальный результат - ВСЕГДА с числовым ID!
      console.log(`💾 Сохраняем финальный результат в game_scores...`);
      resultId = await saveGameScore(
        gameUserId,         // ТОЛЬКО ЧИСЛОВОЙ ID! (975501399 или 1770803251747)
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername,
        isWin
      );
      
      // 🔴 Сохраняем связь между Telegram ID и веб-ID
      if (finalTelegramId && finalWebGameId && finalTelegramId !== finalWebGameId) {
        try {
          await pool.query(
            `INSERT INTO user_links (telegram_id, web_game_id, username) 
             VALUES ($1, $2, $3)
             ON CONFLICT (telegram_id, web_game_id) 
             DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()`,
            [finalTelegramId, finalWebGameId, finalUsername]
          );
          console.log(`🔗 Сохранена связь: ${finalTelegramId} <-> ${finalWebGameId}`);
        } catch (error) {
          console.error('Ошибка сохранения связи:', error);
        }
      }
      
      // Удаляем прогресс
      if (resultId) {
        await deleteGameProgress(gameUserId, finalGameType);
        console.log('🗑️ Прогресс удален');
      }
    } else {
      // Сохраняем прогресс
      console.log(`💾 Сохраняем прогресс в game_progress...`);
      resultId = await saveGameProgress(
        gameUserId,         // ТОЛЬКО ЧИСЛОВОЙ ID!
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername
      );
    }
    
    if (resultId) {
      // Получаем статистику
      const stats = await getGameStats(gameUserId, finalGameType);
      const bestScore = stats?.best_score || 0;
      const gamesPlayed = stats?.games_played || 0;
      const wins = stats?.wins || 0;
      const isNewRecord = numericScore > bestScore;
      
      const achievements = getAchievements(numericScore, numericLevel, numericLines, bestScore);
      const tips = generateTips(numericScore, numericLevel, numericLines, isNewRecord);
      
      console.log('✅ Успешно сохранено!', {
        savedId: resultId,
        gameUserId,
        telegramId: finalTelegramId,
        username: finalUsername,
        score: numericScore,
        bestScore,
        gamesPlayed,
        wins,
        gameOver: finalGameOver,
        isWin,
        achievementsCount: achievements.length,
        isNewRecord
      });
      
      const response = {
        success: true,
        id: resultId,
        userId: gameUserId,           // Числовой ID для игры
        telegramId: finalTelegramId,  // Реальный Telegram ID
        webGameId: finalWebGameId,    // Веб-ID
        username: finalUsername,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: finalGameType,
        gameOver: finalGameOver,
        isWin: isWin,
        isWebApp: false,             // Всегда false - мы не создаем web_ префиксы!
        bestScore: bestScore,
        gamesPlayed: gamesPlayed,
        wins: wins,
        newRecord: isNewRecord,
        
        achievements: {
          count: achievements.length,
          unlocked: achievements,
          notificationBadge: achievements.length > 0 ? achievements[0].badge : '🎮',
          summary: achievements.length > 0 ? 
            `Разблокировано ${achievements.length} достижений!` : 
            'Продолжайте играть для получения достижений!'
        },
        
        tips: tips,
        
        message: finalGameOver ? 
          (isWin ? 
            (isNewRecord ? 
              `🏆 НОВЫЙ РЕКОРД! ${numericScore} очков!` : 
              `Победа! Сохранено ${numericScore} очков`) : 
            `Игра завершена: ${numericScore} очков`) : 
          `Прогресс сохранен: ${numericScore} очков`,
        
        timestamp: new Date().toISOString()
      };
      
      console.log('📤 Отправляем ответ клиенту');
      return res.status(200).json(response);
    } else {
      console.log('❌ Не удалось сохранить в БД');
      return res.status(500).json({ 
        success: false,
        error: 'Database save failed'
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка сохранения:', error);
    return res.status(500).json({ 
      success: false,
      error: `Internal server error: ${error.message}`
    });
  }
}
