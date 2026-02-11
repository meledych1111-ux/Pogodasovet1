import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from './db.js';
import { pool } from './db.js';

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

// 🔴 ФУНКЦИЯ ДЛЯ ОЧИСТКИ ID - ТОЛЬКО ЦИФРЫ!
function cleanUserId(id) {
  if (!id) return null;
  
  const strId = String(id).trim();
  
  // Убираем все префиксы
  let cleanId = strId.replace(/^(web_|test_user_|unknown_|empty_)/, '');
  
  // Оставляем только цифры
  const digitsOnly = cleanId.replace(/[^0-9]/g, '');
  
  if (digitsOnly && digitsOnly.length > 0) {
    console.log(`🧹 Очищен ID: ${strId} -> ${digitsOnly}`);
    return digitsOnly;
  }
  
  return null;
}

export default async function handler(req, res) {
  console.log('📨 POST /api/save-score');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    let body;
    
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch (parseError) {
        body = req.body;
      }
    } else if (req.body) {
      body = req.body;
    } else {
      body = {};
    }
    
    console.log('📊 Тело запроса:', JSON.stringify(body, null, 2));
    
    // 🔴 ИЗВЛЕКАЕМ ТОЛЬКО ЧИСЛОВЫЕ ID
    let numericId = null;
    let sourceField = 'none';
    
    // Приоритет 1: telegramId
    if (body.telegramId) {
      const cleaned = cleanUserId(body.telegramId);
      if (cleaned) {
        numericId = cleaned;
        sourceField = 'telegramId';
      }
    }
    
    // Приоритет 2: userId
    if (!numericId && body.userId) {
      const cleaned = cleanUserId(body.userId);
      if (cleaned) {
        numericId = cleaned;
        sourceField = 'userId';
      }
    }
    
    // Приоритет 3: webGameId
    if (!numericId && body.webGameId) {
      const cleaned = cleanUserId(body.webGameId);
      if (cleaned) {
        numericId = cleaned;
        sourceField = 'webGameId';
      }
    }
    
    // Приоритет 4: data из WebApp
    if (!numericId && body.data) {
      try {
        const parsedData = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
        if (parsedData.userId) {
          const cleaned = cleanUserId(parsedData.userId);
          if (cleaned) {
            numericId = cleaned;
            sourceField = 'data.userId';
          }
        }
      } catch (e) {}
    }
    
    // Приоритет 5: webAppData
    if (!numericId && body.webAppData) {
      try {
        const parsedData = typeof body.webAppData === 'string' ? JSON.parse(body.webAppData) : body.webAppData;
        if (parsedData.userId) {
          const cleaned = cleanUserId(parsedData.userId);
          if (cleaned) {
            numericId = cleaned;
            sourceField = 'webAppData.userId';
          }
        }
      } catch (e) {}
    }
    
    // 🔴 ЕСЛИ ID НЕ НАЙДЕН - ОШИБКА!
    if (!numericId) {
      console.log('❌ Не найден валидный числовой ID');
      return res.status(400).json({ 
        success: false, 
        error: 'Valid numeric user ID is required',
        received: {
          telegramId: body.telegramId,
          userId: body.userId,
          webGameId: body.webGameId
        }
      });
    }
    
    console.log(`✅ Используем числовой ID: ${numericId} (из ${sourceField})`);
    
    // Определяем gameType
    const finalGameType = body.gameType || body.game_type || 'tetris';
    
    // Определяем окончание игры
    let finalGameOver = body.gameOver;
    if (body.isGameOver !== undefined) finalGameOver = body.isGameOver;
    if (body.action === 'tetris_final_score') finalGameOver = true;
    
    // Определяем имя пользователя
    const finalUsername = body.username || body.first_name || `Игрок ${numericId.slice(-4)}`;
    
    // Валидация score
    if (body.score === undefined || body.score === null) {
      return res.status(400).json({ success: false, error: 'Missing score field' });
    }
    
    // Преобразуем значения
    const numericScore = parseInt(body.score) || 0;
    const numericLevel = parseInt(body.level) || 1;
    const numericLines = parseInt(body.lines) || 0;
    const isWin = numericScore > 0;
    
    // 🔴 НЕ СОХРАНЯЕМ ИГРЫ С 0 ОЧКОВ
    if (numericScore === 0) {
      console.log('⚠️ Игра с 0 очков, пропускаем сохранение');
      return res.status(200).json({
        success: true,
        message: 'Игра начата!',
        score: 0,
        skipped: true
      });
    }
    
    console.log('📊 Финальные данные:', {
      userId: numericId,
      score: numericScore,
      level: numericLevel,
      lines: numericLines,
      gameOver: finalGameOver,
      isWin
    });
    
    let result;
    
    if (finalGameOver) {
      // Сохраняем финальный результат - ТОЛЬКО ЧИСЛОВОЙ ID!
      console.log(`💾 Сохраняем результат игры...`);
      result = await saveGameScore(
        numericId,        // 🔴 ТОЛЬКО ЧИСЛА!
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername,
        isWin
      );
      
      // Удаляем прогресс
      if (result && result.success) {
        await deleteGameProgress(numericId, finalGameType);
        console.log('🗑️ Прогресс удален');
      }
    } else {
      // Сохраняем прогресс
      console.log(`💾 Сохраняем прогресс...`);
      result = await saveGameProgress(
        numericId,        // 🔴 ТОЛЬКО ЧИСЛА!
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername
      );
    }
    
    if (result && result.success) {
      // Получаем статистику
      const stats = await getGameStats(numericId, finalGameType);
      const bestScore = stats?.stats?.best_score || 0;
      const gamesPlayed = stats?.stats?.games_played || 0;
      const wins = stats?.stats?.wins || 0;
      const isNewRecord = numericScore > bestScore;
      
      const achievements = getAchievements(numericScore, numericLevel, numericLines, bestScore);
      const tips = generateTips(numericScore, numericLevel, numericLines, isNewRecord);
      
      console.log('✅ Игра сохранена!', {
        userId: numericId,
        score: numericScore,
        bestScore,
        isNewRecord
      });
      
      const response = {
        success: true,
        id: result.id,
        userId: numericId,           // 🔴 ТОЛЬКО ЧИСЛОВОЙ ID!
        username: finalUsername,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: finalGameType,
        gameOver: finalGameOver,
        isWin: isWin,
        isWebApp: false,            // 🔴 НИКАКИХ ПРЕФИКСОВ!
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
      
      return res.status(200).json(response);
    } else {
      console.log('❌ Ошибка сохранения:', result?.error);
      return res.status(500).json({ 
        success: false,
        error: result?.error || 'Database save failed'
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка:', error);
    return res.status(500).json({ 
      success: false,
      error: `Internal server error: ${error.message}`
    });
  }
}
