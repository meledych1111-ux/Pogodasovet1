/**
 * Сохраняет финальный результат игры в game_scores (с расширенной отладкой)
 */
export async function saveGameScore(userId, gameType, score, level, lines, username = null, isWin = true) {
  console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ НАЧАЛО ==========');
  console.log('📥 Входные параметры:', {
    userId,
    gameType,
    score,
    level,
    lines,
    username,
    isWin,
    timestamp: new Date().toISOString()
  });
  
  if (!pool) {
    console.error('❌ saveGameScore: Пул подключения не инициализирован');
    return { 
      success: false, 
      error: 'Нет подключения к БД',
      id: null 
    };
  }
  
  // 🔴 ВАЖНО: Не сохраняем игру с нулевым счетом
  const numericScore = parseInt(score) || 0;
  if (numericScore === 0 && isWin) {
    console.log('⚠️ Игра с 0 очками, пропускаем сохранение');
    return { 
      success: false, 
      error: 'Игра с нулевым счетом',
      id: null 
    };
  }
  
  const dbUserId = convertUserIdForDb(userId);
  console.log(`🔧 Преобразованный user_id: "${dbUserId}" (оригинал: "${userId}")`);
  
  const finalUsername = username || `Игрок_${String(dbUserId).slice(-4)}`;
  console.log(`👤 Имя для сохранения: "${finalUsername}"`);
  
  console.log(`🎮 Попытка сохранения: ${dbUserId} - ${numericScore} очков (${gameType})`);
  
  const client = await pool.connect();
  console.log('🔗 Подключение к БД получено');
  
  try {
    // 1. Получаем актуальный город пользователя
    console.log('📍 Шаг 1: Получаем город пользователя...');
    let currentCity = 'Не указан';
    
    // Пробуем разные способы получить город
    try {
      // Сначала через getUserCity
      const cityResult = await getUserCity(userId);
      if (cityResult.success && cityResult.city !== 'Не указан') {
        currentCity = cityResult.city;
        console.log(`✅ Город получен через getUserCity: "${currentCity}"`);
      } else {
        // Пробуем через профиль
        const userProfile = await getUserProfile(dbUserId);
        if (userProfile?.city && userProfile.city !== 'Не указан') {
          currentCity = userProfile.city;
          console.log(`✅ Город получен из профиля: "${currentCity}"`);
        } else {
          // Пробуем через user_sessions
          const sessionResult = await client.query(
            'SELECT selected_city FROM user_sessions WHERE user_id = $1',
            [dbUserId]
          );
          if (sessionResult.rows[0]?.selected_city && 
              sessionResult.rows[0].selected_city !== 'Не указан') {
            currentCity = sessionResult.rows[0].selected_city;
            console.log(`✅ Город получен из user_sessions: "${currentCity}"`);
          }
        }
      }
    } catch (cityError) {
      console.error('❌ Ошибка получения города:', cityError.message);
    }
    
    console.log(`📍 Итоговый город для сохранения: "${currentCity}"`);
    
    // 2. Сохраняем/обновляем пользователя
    console.log('👤 Шаг 2: Сохраняем/обновляем пользователя...');
    const userSaveResult = await saveOrUpdateUser({
      user_id: dbUserId,
      username: finalUsername,
      first_name: finalUsername,
      city: currentCity, // Используем полученный город
      chat_id: null
    });
    
    if (userSaveResult) {
      console.log(`✅ Пользователь сохранен/обновлен. ID: ${userSaveResult}`);
    } else {
      console.log('⚠️ Не удалось сохранить пользователя, продолжаем...');
    }
    
    // 3. Сохраняем результат игры
    console.log('🎮 Шаг 3: Сохраняем результат игры в game_scores...');
    
    // 🔴 ВАЖНО: Если игра не завершена и мало очков - сохраняем как прогресс
    if (!isWin && numericScore < 1000) {
      console.log('⚠️ Игра не завершена или мало очков, сохраняем как прогресс');
      const progressResult = await saveGameProgress(userId, gameType, score, level, lines, username);
      
      return {
        success: true,
        id: null,
        user_id: dbUserId,
        username: finalUsername,
        score: numericScore,
        city: currentCity,
        saved_as_progress: true,
        progress_id: progressResult.user_id
      };
    }
    
    const gameQuery = `
      INSERT INTO game_scores (
        user_id, 
        username, 
        game_type, 
        score, 
        level, 
        lines, 
        is_win,
        city
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING id, created_at
    `;
    
    const queryParams = [
      dbUserId, 
      finalUsername, 
      gameType || 'tetris', 
      numericScore, 
      parseInt(level) || 1, 
      parseInt(lines) || 0,
      isWin,
      currentCity  // 🔴 Город передается в запрос
    ];
    
    console.log('📝 Параметры SQL запроса:', queryParams);
    
    const result = await client.query(gameQuery, queryParams);
    
    const savedId = result.rows[0]?.id;
    const createdAt = result.rows[0]?.created_at;
    
    console.log(`✅ Результат игры сохранен! ID: ${savedId}, город: "${currentCity}"`);
    
    // 4. Удаляем прогресс (если был)
    if (isWin) {
      console.log('🗑️ Шаг 4: Удаляем сохраненный прогресс...');
      try {
        await client.query(
          'DELETE FROM game_progress WHERE user_id = $1 AND game_type = $2',
          [dbUserId, gameType || 'tetris']
        );
        console.log('✅ Прогресс удален');
      } catch (deleteError) {
        console.error('⚠️ Ошибка удаления прогресса:', deleteError.message);
      }
    }
    
    console.log('🎮✅ ========== СОХРАНЕНИЕ ИГРЫ УСПЕШНО ==========');
    
    return { 
      success: true, 
      id: savedId,
      user_id: dbUserId,
      username: finalUsername,
      score: numericScore,
      level: parseInt(level) || 1,
      lines: parseInt(lines) || 0,
      game_type: gameType || 'tetris',
      city: currentCity,
      is_win: isWin,
      created_at: createdAt
    };
    
  } catch (error) {
    console.error('💥❌ ОШИБКА СОХРАНЕНИЯ ИГРЫ:', error.message);
    console.error('🔢 Код ошибки:', error.code);
    console.error('📌 Stack trace:', error.stack);
    
    // Пробуем сохранить как прогресс как fallback
    try {
      console.log('🔄 Пробуем сохранить как прогресс (fallback)...');
      const progressResult = await saveGameProgress(userId, gameType, score, level, lines, username);
      
      if (progressResult.success) {
        console.log('✅ Данные сохранены как прогресс (fallback)');
        return {
          success: true,
          id: null,
          user_id: dbUserId,
          username: finalUsername,
          score: numericScore,
          city: 'Не указан', // В fallback режиме не используем город
          saved_as_progress: true,
          saved_as_fallback: true,
          progress_id: progressResult.user_id,
          original_error: error.message
        };
      }
    } catch (progressError) {
      console.error('❌ Fallback сохранение тоже не удалось:', progressError.message);
    }
    
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      user_id: dbUserId,
      score: numericScore
    };
  } finally {
    console.log('🔌 Освобождаем подключение к БД...');
    client.release();
    console.log('🎮🔄 ========== СОХРАНЕНИЕ ИГРЫ КОНЕЦ ==========\n');
  }
}
