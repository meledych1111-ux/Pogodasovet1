import { saveGameScore, saveGameProgress, deleteGameProgress, getGameStats } from './db.js';

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

// 🔴 ДОБАВЬ ЭТУ ФУНКЦИЮ
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
    
    // Извлекаем все возможные поля с разных форматов
    const {
      // Основные поля (современный формат)
      userId,
      user_id,
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
      
      // Старые форматы
      user_id: old_user_id,
      game_type: old_game_type,
      game_over,
      
      // Web App данные
      data,
      webAppData
    } = body;
    
    // Логируем все полученные поля
    console.log('📊 Извлеченные поля:', {
      userId,
      user_id,
      old_user_id,
      score,
      level,
      lines,
      gameType,
      game_type,
      old_game_type,
      gameOver,
      isGameOver,
      game_over,
      action,
      username,
      first_name,
      last_name,
      data,
      webAppData
    });
    
    // Определяем ID пользователя (приоритет по порядку)
    let finalUserId = null;
    let isWebApp = false;
    
    // Приоритет 1: userId (современный формат)
    if (userId) {
      finalUserId = String(userId);
      isWebApp = finalUserId.startsWith('web_');
      console.log(`✅ Используем userId: ${finalUserId} (isWebApp: ${isWebApp})`);
    }
    // Приоритет 2: user_id (старый формат)
    else if (user_id) {
      finalUserId = String(user_id);
      isWebApp = finalUserId.startsWith('web_');
      console.log(`✅ Используем user_id: ${finalUserId} (isWebApp: ${isWebApp})`);
    }
    // Приоритет 3: old_user_id (очень старый формат)
    else if (old_user_id) {
      finalUserId = String(old_user_id);
      isWebApp = finalUserId.startsWith('web_');
      console.log(`✅ Используем old_user_id: ${finalUserId} (isWebApp: ${isWebApp})`);
    }
    // Приоритет 4: data из Web App
    else if (data) {
      try {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        if (parsedData.userId || parsedData.user_id) {
          finalUserId = String(parsedData.userId || parsedData.user_id);
          isWebApp = finalUserId.startsWith('web_');
          console.log(`✅ Используем data.userId: ${finalUserId} (isWebApp: ${isWebApp})`);
        }
      } catch (e) {
        console.log('⚠️ Не удалось распарсить data:', e.message);
      }
    }
    // Приоритет 5: webAppData
    else if (webAppData) {
      try {
        const parsedData = typeof webAppData === 'string' ? JSON.parse(webAppData) : webAppData;
        if (parsedData.userId || parsedData.user_id) {
          finalUserId = String(parsedData.userId || parsedData.user_id);
          isWebApp = finalUserId.startsWith('web_');
          console.log(`✅ Используем webAppData.userId: ${finalUserId} (isWebApp: ${isWebApp})`);
        }
      } catch (e) {
        console.log('⚠️ Не удалось распарсить webAppData:', e.message);
      }
    }
    
    // Если ID не найден
    if (!finalUserId) {
      console.log('❌ Не найден userId ни в одном из форматов');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing userId field. Supported fields: userId, user_id, data.userId',
        received_data: body
      });
    }
    
    // Определяем gameType
    let finalGameType = gameType;
    if (game_type) finalGameType = game_type;
    if (old_game_type) finalGameType = old_game_type;
    
    // Если из данных есть gameType
    if (data) {
      try {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        if (parsedData.gameType || parsedData.game_type) {
          finalGameType = parsedData.gameType || parsedData.game_type;
        }
      } catch (e) {
        // Игнорируем ошибку парсинга
      }
    }
    
    // Определяем окончание игры
    let finalGameOver = gameOver;
    if (isGameOver !== undefined) finalGameOver = isGameOver;
    if (game_over !== undefined) finalGameOver = game_over;
    if (action === 'tetris_final_score') finalGameOver = true;
    
    // Определяем имя пользователя
    let finalUsername = username || first_name || `Игрок ${finalUserId.slice(-4)}`;
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
    const isWin = numericScore > 0; // Простая логика: если есть очки - победа
    
    console.log('📊 Финальные данные для сохранения:', {
      finalUserId,
      finalUsername,
      numericScore,
      numericLevel,
      numericLines,
      finalGameType,
      finalGameOver,
      isWebApp,
      isWin
    });
    
    let resultId;
    
    if (finalGameOver) {
      // Если игра завершена, сохраняем финальный результат в game_scores
      console.log(`💾 Сохраняем финальный результат в game_scores...`);
      resultId = await saveGameScore(
        finalUserId,        // ID: "web_123" или "123456"
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername,      // Имя пользователя
        isWin               // Победа или проигрыш
      );
      
      // Удаляем прогресс, так как игра завершена
      if (resultId) {
        await deleteGameProgress(finalUserId, finalGameType);
        console.log('🗑️ Прогресс удален, игра завершена');
      }
    } else {
      // Если игра продолжается, сохраняем прогресс в game_progress
      console.log(`💾 Сохраняем прогресс в game_progress...`);
      resultId = await saveGameProgress(
        finalUserId, 
        finalGameType, 
        numericScore, 
        numericLevel, 
        numericLines,
        finalUsername
      );
    }
    
    if (resultId) {
      // Получаем обновленную статистику
      const stats = await getGameStats(finalUserId, finalGameType);
      const bestScore = stats?.best_score || 0;
      const gamesPlayed = stats?.games_played || 0;
      const wins = stats?.wins || 0;
      const isNewRecord = numericScore > bestScore;
      
      // 🔴 ПОЛУЧАЕМ ДОСТИЖЕНИЯ
      const achievements = getAchievements(numericScore, numericLevel, numericLines, bestScore);
      const hasAchievements = achievements.length > 0;
      
      // 🔴 ГЕНЕРИРУЕМ СОВЕТЫ
      const tips = generateTips(numericScore, numericLevel, numericLines, isNewRecord);
      
      console.log('✅ Успешно сохранено!', {
        savedId: resultId,
        userId: finalUserId,
        username: finalUsername,
        score: numericScore,
        bestScore: bestScore,
        gamesPlayed: gamesPlayed,
        wins: wins,
        gameOver: finalGameOver,
        isWebApp: isWebApp,
        isWin: isWin,
        achievementsCount: achievements.length,
        isNewRecord: isNewRecord
      });
      
      // 🔴 ОБНОВЛЕННЫЙ ОТВЕТ С ДОСТИЖЕНИЯМИ
      const response = {
        success: true,
        id: resultId,
        userId: finalUserId,
        username: finalUsername,
        score: numericScore,
        level: numericLevel,
        lines: numericLines,
        gameType: finalGameType,
        gameOver: finalGameOver,
        isWin: isWin,
        isWebApp: isWebApp,
        bestScore: bestScore,
        gamesPlayed: gamesPlayed,
        wins: wins,
        newRecord: isNewRecord,
        
        // 🔴 ДОБАВЛЕНО: Система достижений
        achievements: {
          count: achievements.length,
          unlocked: achievements,
          notificationBadge: achievements.length > 0 ? achievements[0].badge : '🎮',
          summary: achievements.length > 0 ? 
            `Разблокировано ${achievements.length} достижений!` : 
            'Продолжайте играть для получения достижений!'
        },
        
        // 🔴 ДОБАВЛЕНО: Советы
        tips: tips,
        
        // 🔴 УЛУЧШЕННОЕ СООБЩЕНИЕ
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
      console.log('❌ Не удалось сохранить в БД (resultId is null)');
      return res.status(500).json({ 
        success: false,
        error: 'Database save failed. No ID returned.',
        savedData: {
          userId: finalUserId,
          score: numericScore,
          gameOver: finalGameOver
        }
      });
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка сохранения:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    return res.status(500).json({ 
      success: false,
      error: `Internal server error: ${error.message}`,
      timestamp: new Date().toISOString(),
      // Детали только для разработки
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        fullError: error.toString()
      })
    });
  }
}
