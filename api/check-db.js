// api/check-db.js
import { checkDatabaseConnection, pool, diagnoseConnection } from './db.js';

export default async function handler(req, res) {
  console.log('🔍 API: /api/check-db - проверка базы данных');
  console.log('🔍 Метод:', req.method);
  
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка предварительного запроса OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET' && req.method !== 'POST') {
    console.log('❌ Метод не разрешен:', req.method);
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET or POST.' 
    });
  }

  try {
    console.log('🔍 Начинаю проверку базы данных...');
    
    // Проверяем наличие DATABASE_URL
    const hasDbUrl = !!process.env.DATABASE_URL;
    console.log('🔍 DATABASE_URL присутствует:', hasDbUrl);
    
    if (!hasDbUrl) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_URL environment variable is not set',
        details: {
          missing_variables: ['DATABASE_URL'],
          message: 'Проверьте переменные окружения в Vercel'
        }
      });
    }
    
    // Проверяем формат DATABASE_URL (без пароля в логах)
    const dbUrl = process.env.DATABASE_URL;
    const maskedUrl = dbUrl ? dbUrl.replace(/:[^:@]*@/, ':***@') : 'not set';
    console.log('🔍 DATABASE_URL (маскированный):', maskedUrl);
    
    // Проверяем подключение через стандартную функцию
    console.log('🔍 Проверяем подключение через checkDatabaseConnection...');
    const connectionResult = await checkDatabaseConnection();
    
    console.log('🔍 Результат подключения:', connectionResult);
    
    if (connectionResult.success) {
      // Если подключение успешно, получаем дополнительную информацию
      console.log('🔍 Подключение успешно, получаем дополнительную информацию...');
      
      try {
        // Используем существующий pool из db.js
        const client = await pool.connect();
        
        try {
          // 🔴 ВАЖНО: Проверяем ТОЧНЫЕ имена таблиц
          const expectedTables = [
            'user_sessions', 
            'game_scores', 
            'game_progress',
            'tetris_stats'
          ];
          
          // Получаем информацию о таблицах
          const tablesQuery = await client.query(`
            SELECT 
              table_name,
              table_type
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
          `);
          
          // Получаем существующие таблицы
          const existingTables = tablesQuery.rows.map(row => row.table_name);
          const missingTables = expectedTables.filter(table => 
            !existingTables.includes(table)
          );
          
          // Получаем статистику по таблицам
          const tablesInfo = await Promise.all(
            tablesQuery.rows.map(async (table) => {
              try {
                // БЕЗОПАСНЫЙ ЗАПРОС для подсчета строк
                const countResult = await client.query({
                  text: `SELECT COUNT(*) as count FROM "${table.table_name}"`,
                  rowMode: 'array'
                });
                
                // ДОБАВЛЕНО: Для game_scores получаем дополнительную информацию
                let additionalInfo = {};
                if (table.table_name === 'game_scores') {
                  try {
                    const columnQuery = await client.query(`
                      SELECT column_name, data_type, character_maximum_length
                      FROM information_schema.columns
                      WHERE table_name = 'game_scores'
                      AND table_schema = 'public'
                      ORDER BY ordinal_position
                    `);
                    
                    additionalInfo.columns = columnQuery.rows.map(col => ({
                      name: col.column_name,
                      type: col.data_type,
                      max_length: col.character_maximum_length
                    }));
                    
                    // Проверяем наличие важных столбцов
                    const importantColumns = ['username', 'user_id', 'is_win', 'game_type'];
                    const existingColumns = columnQuery.rows.map(col => col.column_name);
                    const missingColumns = importantColumns.filter(col => 
                      !existingColumns.includes(col)
                    );
                    
                    additionalInfo.missing_columns = missingColumns;
                    additionalInfo.has_username = existingColumns.includes('username');
                    additionalInfo.has_is_win = existingColumns.includes('is_win');
                    additionalInfo.has_game_type = existingColumns.includes('game_type');
                  } catch (colError) {
                    additionalInfo.column_error = colError.message;
                  }
                }
                
                // ДОБАВЛЕНО: Проверяем user_sessions
                if (table.table_name === 'user_sessions') {
                  try {
                    const columnQuery = await client.query(`
                      SELECT column_name, data_type
                      FROM information_schema.columns
                      WHERE table_name = 'user_sessions'
                      AND table_schema = 'public'
                      ORDER BY ordinal_position
                    `);
                    
                    additionalInfo.columns = columnQuery.rows.map(col => ({
                      name: col.column_name,
                      type: col.data_type
                    }));
                    
                    const importantColumns = ['user_id', 'selected_city', 'username'];
                    const existingColumns = columnQuery.rows.map(col => col.column_name);
                    const missingColumns = importantColumns.filter(col => 
                      !existingColumns.includes(col)
                    );
                    
                    additionalInfo.missing_columns = missingColumns;
                  } catch (colError) {
                    additionalInfo.column_error = colError.message;
                  }
                }
                
                return {
                  name: table.table_name,
                  type: table.table_type,
                  row_count: parseInt(countResult.rows[0]?.[0]) || 0,
                  ...additionalInfo
                };
              } catch (err) {
                return {
                  name: table.table_name,
                  type: table.table_type,
                  error: err.message,
                  row_count: 0
                };
              }
            })
          );
          
          // Получаем статистику по game_scores
          let gameStats = null;
          try {
            // АДАПТИВНЫЙ ЗАПРОС: Проверяем наличие столбцов перед выполнением
            const columnsCheck = await client.query(`
              SELECT column_name 
              FROM information_schema.columns 
              WHERE table_name = 'game_scores' 
              AND table_schema = 'public'
            `);
            
            const hasGameType = columnsCheck.rows.some(col => col.column_name === 'game_type');
            const hasIsWin = columnsCheck.rows.some(col => col.column_name === 'is_win');
            
            // СОЗДАЕМ ЗАПРОС С УЧЕТОМ НАЛИЧИЯ СТОЛБЦОВ
            let statsQuery = `
              SELECT 
                COUNT(*) as total_games,
                COUNT(DISTINCT user_id) as unique_players,
                COALESCE(MAX(score), 0) as max_score,
                COALESCE(MIN(score), 0) as min_score,
                COALESCE(AVG(score), 0) as avg_score,
                COUNT(CASE WHEN user_id::text LIKE 'web_%' THEN 1 END) as web_users_count,
                COUNT(CASE WHEN username IS NOT NULL AND username != '' THEN 1 END) as games_with_names
            `;
            
            if (hasIsWin) {
              statsQuery += `,
                COUNT(CASE WHEN is_win THEN 1 END) as total_wins
              `;
            }
            
            statsQuery += `
              FROM game_scores 
              WHERE ${hasGameType ? "game_type = 'tetris' OR game_type IS NULL" : '1=1'}
            `;
            
            const statsResult = await client.query(statsQuery);
            gameStats = statsResult.rows[0];
            gameStats.has_game_type = hasGameType;
            gameStats.has_is_win = hasIsWin;
            
            // ДОБАВЛЕНО: Получаем топ игроков для проверки
            try {
              let topQuery = `
                SELECT 
                  user_id,
                  username,
                  MAX(score) as best_score,
                  COUNT(*) as games_played
                FROM game_scores 
                WHERE ${hasGameType ? "game_type = 'tetris' OR game_type IS NULL" : '1=1'}
                GROUP BY user_id, username
                ORDER BY MAX(score) DESC 
                LIMIT 3
              `;
              
              const topPlayers = await client.query(topQuery);
              gameStats.top_players = topPlayers.rows;
            } catch (topError) {
              gameStats.top_error = topError.message;
            }
          } catch (statsError) {
            console.log('⚠️ Не удалось получить статистику игр:', statsError.message);
            gameStats = { 
              error: statsError.message,
              hint: 'Возможно, таблица game_scores имеет старую структуру'
            };
          }
          
          // 🔴 ДОБАВЛЕНО: Специальная диагностика для функции getTopPlayers
          console.log('🔍 Выполняем специальную диагностику для getTopPlayers...');
          const topPlayersDiagnostics = await diagnoseGetTopPlayersIssue(client);
          
          // ДОБАВЛЕНО: Получаем информацию о структуре user_id
          let idStructureInfo = {};
          try {
            const idTypesQuery = await client.query(`
              SELECT 
                CASE 
                  WHEN user_id::text LIKE 'web_%' THEN 'web_app'
                  WHEN LENGTH(user_id::text) <= 10 AND user_id ~ '^[0-9]+$' THEN 'telegram_numeric'
                  ELSE 'other'
                END as id_type,
                COUNT(*) as count
              FROM game_scores 
              GROUP BY id_type
              ORDER BY count DESC
            `);
            
            idStructureInfo.id_types = idTypesQuery.rows;
          } catch (idError) {
            idStructureInfo.error = idError.message;
          }
          
          // ДОБАВЛЕНО: Получаем информацию об индексах
          let indexesInfo = {};
          try {
            const indexesQuery = await client.query(`
              SELECT 
                indexname,
                indexdef
              FROM pg_indexes 
              WHERE tablename IN ('user_sessions', 'game_scores', 'game_progress', 'tetris_stats')
              AND schemaname = 'public'
              ORDER BY tablename, indexname
            `);
            
            indexesInfo.indexes = indexesQuery.rows;
          } catch (indexError) {
            indexesInfo.error = indexError.message;
          }
          
          // ДОБАВЛЕНО: Проверяем tetris_stats
          let tetrisStatsInfo = {};
          try {
            const tetrisStatsQuery = await client.query(`
              SELECT 
                COUNT(*) as total_players,
                COALESCE(SUM(games_played), 0) as total_games,
                COALESCE(MAX(best_score), 0) as max_score,
                COALESCE(AVG(best_score), 0) as avg_best_score
              FROM tetris_stats
            `);
            
            tetrisStatsInfo.summary = tetrisStatsQuery.rows[0];
            
            // Получаем топ из tetris_stats для сравнения
            const tetrisTopQuery = await client.query(`
              SELECT 
                user_id,
                username,
                best_score,
                games_played
              FROM tetris_stats
              WHERE best_score > 0
              ORDER BY best_score DESC
              LIMIT 3
            `);
            
            tetrisStatsInfo.top_players = tetrisTopQuery.rows;
          } catch (tetrisError) {
            tetrisStatsInfo.error = tetrisError.message;
          }
          
          const response = {
            success: true,
            timestamp: new Date().toISOString(),
            connection: {
              status: 'connected',
              time: connectionResult.time,
              message: 'База данных подключена успешно'
            },
            environment: {
              has_database_url: true,
              node_env: process.env.NODE_ENV || 'development',
              vercel_env: process.env.VERCEL_ENV || 'development',
              database_url_preview: maskedUrl.substring(0, 100),
              is_neon: dbUrl.includes('neon.tech'),
              is_vercel: !!process.env.VERCEL
            },
            database_info: {
              tables: tablesInfo,
              total_tables: tablesInfo.length,
              expected_tables: expectedTables,
              existing_tables: existingTables,
              missing_tables: missingTables,
              all_tables_present: missingTables.length === 0,
              game_stats: gameStats,
              id_structure: idStructureInfo,
              indexes: indexesInfo,
              tetris_stats: tetrisStatsInfo
            },
            // 🔴 ДОБАВЛЕНО: Специальная диагностика для getTopPlayers
            get_top_players_diagnostics: topPlayersDiagnostics,
            
            system_status: {
              database: missingTables.length === 0 ? 'ok' : 'warning',
              structure: gameStats?.error ? 'error' : 'ok',
              data_integrity: gameStats?.total_games > 0 ? 'has_data' : 'no_data',
              get_top_players_ready: topPlayersDiagnostics.get_top_players_ready
            },
            recommendations: [
              ...(missingTables.length > 0 
                ? [`Отсутствуют таблицы: ${missingTables.join(', ')}. Запустите инициализацию БД.`]
                : ['✅ Все таблицы присутствуют.']),
              ...topPlayersDiagnostics.suggestions
            ],
            
            structure_check: {
              game_scores_has_username: tablesInfo.find(t => t.name === 'game_scores')?.has_username || false,
              game_scores_has_is_win: tablesInfo.find(t => t.name === 'game_scores')?.has_is_win || false,
              game_scores_has_game_type: tablesInfo.find(t => t.name === 'game_scores')?.has_game_type || false,
              user_sessions_has_city: tablesInfo.find(t => t.name === 'user_sessions')?.columns?.some(c => c.name === 'selected_city') || false,
              suggestion: gameStats?.has_is_win === false ? 
                'Добавьте поле is_win в таблицу game_scores для отслеживания побед' : 
                'Структура таблиц соответствует требованиям'
            }
          };
          
          console.log('✅ Проверка завершена успешно');
          console.log('📊 Сводка:', {
            tables: response.database_info.total_tables,
            missing_tables: response.database_info.missing_tables.length,
            total_games: response.database_info.game_stats?.total_games || 0,
            unique_players: response.database_info.game_stats?.unique_players || 0,
            get_top_players_ready: topPlayersDiagnostics.get_top_players_ready
          });
          
          return res.status(200).json(response);
          
        } finally {
          client.release();
          console.log('🔌 Клиент подключения освобожден');
        }
        
      } catch (infoError) {
        console.error('⚠️ Ошибка получения информации о БД:', infoError);
        
        // Возвращаем хотя бы результат подключения
        return res.status(200).json({
          success: true,
          timestamp: new Date().toISOString(),
          connection: {
            status: 'connected',
            time: connectionResult.time,
            message: 'База данных подключена, но не удалось получить полную информацию'
          },
          warning: infoError.message,
          diagnostics: await diagnoseConnection(),
          recommendation: 'Проверьте права доступа к таблицам информации схемы'
        });
      }
      
    } else {
      // Подключение не удалось
      console.error('❌ Ошибка подключения к БД:', connectionResult.error);
      
      const errorResponse = {
        success: false,
        timestamp: new Date().toISOString(),
        error: {
          message: connectionResult.error || 'Неизвестная ошибка подключения',
          code: 'DATABASE_CONNECTION_FAILED',
          details: {
            has_database_url: hasDbUrl,
            masked_url: maskedUrl,
            node_env: process.env.NODE_ENV || 'development',
            is_neon: dbUrl?.includes('neon.tech') || false
          }
        },
        diagnostics: await diagnoseConnection(),
        troubleshooting: [
          '1. Проверьте переменную окружения DATABASE_URL в Vercel Dashboard',
          '2. Убедитесь, что база данных Neon активна и не приостановлена',
          '3. Проверьте SSL параметры: Neon требует sslmode=require или verify-full'
        ]
      };
      
      return res.status(500).json(errorResponse);
    }
    
  } catch (error) {
    console.error('🔥 Критическая ошибка проверки БД:', error);
    console.error('🔥 Stack trace:', error.stack);
    
    const errorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        code: 'CRITICAL_DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          type: error.constructor.name
        } : undefined
      },
      message: 'Критическая ошибка при проверке базы данных',
      diagnostics: await diagnoseConnection().catch(e => ({ diagnostic_error: e.message })),
      troubleshooting: [
        '1. Проверьте логи Vercel для деталей',
        '2. Убедитесь, что все зависимости установлены',
        '3. Проверьте конфигурацию PostgreSQL в Neon'
      ]
    };
    
    return res.status(500).json(errorResponse);
  }
}

// 🔴 ДОБАВЛЕНО: Функция для диагностики проблемы с getTopPlayers
async function diagnoseGetTopPlayersIssue(client) {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    issues: [],
    suggestions: [],
    get_top_players_ready: true
  };
  
  try {
    console.log('🔍 Диагностика: проверяем структуру для getTopPlayers...');
    
    // 1. Проверяем структуру таблицы game_scores
    const columnsQuery = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'game_scores'
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    const columns = columnsQuery.rows.map(col => col.column_name);
    diagnostics.columns_in_game_scores = columns;
    
    // Проверяем необходимые для getTopPlayers столбцы
    const requiredColumns = ['user_id', 'username', 'score', 'level', 'lines', 'is_win', 'game_type'];
    const missingColumns = requiredColumns.filter(col => !columns.includes(col));
    
    if (missingColumns.length > 0) {
      diagnostics.issues.push(`Отсутствуют необходимые столбцы в game_scores: ${missingColumns.join(', ')}`);
      diagnostics.suggestions.push(`Добавьте недостающие столбцы: ${missingColumns.join(', ')}`);
      diagnostics.get_top_players_ready = false;
    }
    
    // 2. Проверяем типы данных user_id
    try {
      const userIdTypeQuery = await client.query(`
        SELECT 
          data_type,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_name = 'game_scores'
        AND column_name = 'user_id'
        AND table_schema = 'public'
      `);
      
      if (userIdTypeQuery.rows.length > 0) {
        diagnostics.user_id_type = userIdTypeQuery.rows[0];
        
        // Если user_id имеет тип integer/bigint, это может вызывать проблемы
        if (userIdTypeQuery.rows[0].data_type === 'integer' || userIdTypeQuery.rows[0].data_type === 'bigint') {
          diagnostics.issues.push(`user_id имеет числовой тип (${userIdTypeQuery.rows[0].data_type}), но в user_sessions - текст. Это может вызывать ошибки JOIN.`);
          diagnostics.suggestions.push(`Измените тип user_id на VARCHAR в одной из таблиц для совместимости`);
        }
      }
    } catch (typeError) {
      diagnostics.user_id_type_error = typeError.message;
    }
    
    // 3. Проверяем наличие данных для топа
    try {
      const topDataQuery = await client.query(`
        SELECT 
          COUNT(DISTINCT user_id) as players_with_score,
          COUNT(CASE WHEN score > 0 THEN 1 END) as games_with_score
        FROM game_scores
        WHERE (game_type = 'tetris' OR game_type IS NULL)
      `);
      
      diagnostics.top_data_summary = topDataQuery.rows[0];
      
      if (topDataQuery.rows[0].players_with_score === 0) {
        diagnostics.issues.push(`Нет игроков с результатами > 0 в game_scores`);
        diagnostics.suggestions.push(`Играйте в тетрис для создания результатов`);
      }
    } catch (dataError) {
      diagnostics.top_data_error = dataError.message;
    }
    
    // 4. Тестируем запрос похожий на тот, что в getTopPlayers
    try {
      console.log('🔍 Тестируем запрос для getTopPlayers...');
      
      // Пробуем выполнить упрощенный вариант запроса
      const testQuery = `
        SELECT 
          gs.user_id,
          gs.username,
          MAX(gs.score) as best_score,
          COUNT(*) as games_played
        FROM game_scores gs
        WHERE gs.score > 0
        GROUP BY gs.user_id, gs.username
        ORDER BY MAX(gs.score) DESC
        LIMIT 3
      `;
      
      const testResult = await client.query(testQuery);
      diagnostics.test_query_success = true;
      diagnostics.test_query_results_count = testResult.rows.length;
      diagnostics.test_query_issue = null;
      
      console.log('✅ Тестовый запрос выполнен успешно:', testResult.rows.length, 'результатов');
      
    } catch (testError) {
      diagnostics.test_query_success = false;
      diagnostics.test_query_error = testError.message;
      diagnostics.get_top_players_ready = false;
      
      console.error('❌ Тестовый запрос не удался:', testError.message);
      
      // Анализируем ошибку
      if (testError.message.includes('must appear in the GROUP BY clause')) {
        diagnostics.issues.push(`Ошибка GROUP BY: ${testError.message}`);
        diagnostics.suggestions.push(`В запросе getTopPlayers убедитесь, что все SELECT столбцы либо в GROUP BY, либо в агрегатных функциях (MAX, COUNT)`);
      } else if (testError.message.includes('column "gs.username"')) {
        diagnostics.issues.push(`Проблема с username: ${testError.message}`);
        diagnostics.suggestions.push(`Используйте MAX(gs.username) в SELECT вместо gs.username, или добавьте gs.username в GROUP BY`);
      } else if (testError.message.includes('operator does not exist')) {
        diagnostics.issues.push(`Проблема с типами данных: ${testError.message}`);
        diagnostics.suggestions.push(`Проверьте типы данных в JOIN условиях, возможно нужно CAST(user_id AS VARCHAR)`);
      }
    }
    
    // 5. Проверяем таблицу user_sessions для JOIN
    try {
      const userSessionsQuery = await client.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'user_sessions'
        AND table_schema = 'public'
        AND column_name IN ('user_id', 'username', 'selected_city')
      `);
      
      diagnostics.user_sessions_columns = userSessionsQuery.rows;
      
      // Проверяем совместимость типов для JOIN
      const userSessionsUserIdType = userSessionsQuery.rows.find(col => col.column_name === 'user_id')?.data_type;
      if (diagnostics.user_id_type?.data_type && userSessionsUserIdType) {
        if (diagnostics.user_id_type.data_type !== userSessionsUserIdType) {
          diagnostics.issues.push(`Типы user_id не совпадают: game_scores.${diagnostics.user_id_type.data_type} vs user_sessions.${userSessionsUserIdType}`);
          diagnostics.suggestions.push(`Используйте CAST в JOIN: ON gs.user_id::text = us.user_id`);
        }
      }
    } catch (usError) {
      diagnostics.user_sessions_error = usError.message;
    }
    
  } catch (error) {
    diagnostics.diagnostic_error = error.message;
    diagnostics.get_top_players_ready = false;
    console.error('❌ Ошибка диагностики getTopPlayers:', error);
  }
  
  return diagnostics;
}

// Функция для тестирования подключения
export const testDatabaseConnection = async () => {
  try {
    console.log('🧪 Тестирование подключения к базе данных...');
    const result = await checkDatabaseConnection();
    console.log('🧪 Результат теста:', result);
    return result;
  } catch (error) {
    console.error('🧪 Ошибка теста:', error);
    return { success: false, error: error.message };
  }
};

// 🔴 ДОБАВЛЕНО: Функция для быстрой проверки getTopPlayers
export const testGetTopPlayersQuery = async () => {
  try {
    console.log('🧪 Тестирование запроса getTopPlayers...');
    const client = await pool.connect();
    
    try {
      const testQuery = `
        WITH player_stats AS (
          SELECT 
            gs.user_id,
            MAX(COALESCE(gs.username, 'Игрок')) as username,
            MAX(gs.score) as best_score,
            COUNT(*) as games_played,
            MAX(gs.created_at) as last_played
          FROM game_scores gs
          WHERE gs.score > 0
          GROUP BY gs.user_id
          ORDER BY MAX(gs.score) DESC
          LIMIT 3
        )
        SELECT * FROM player_stats
      `;
      
      const result = await client.query(testQuery);
      console.log('🧪 Результат тестового запроса:', result.rows.length, 'игроков');
      
      return {
        success: true,
        players: result.rows,
        count: result.rows.length
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('🧪 Ошибка теста getTopPlayers:', error.message);
    return {
      success: false,
      error: error.message,
      hint: error.message.includes('must appear in the GROUP BY') 
        ? 'Используйте MAX() для всех столбцов не в GROUP BY' 
        : 'Проверьте структуру таблицы'
    };
  }
};

// Если файл запущен напрямую, выполнить тест
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Запуск теста check-db.js');
  console.log('⚠️ Внимание: Этот файл должен запускаться через API route, не напрямую');
  
  // Для тестирования напрямую
  import('./db.js').then(async (db) => {
    const result = await db.checkDatabaseConnection();
    console.log('🧪 Результат теста подключения:', result);
    
    if (result.success) {
      // Тестируем запрос getTopPlayers
      const topPlayersTest = await testGetTopPlayersQuery();
      console.log('🧪 Тест getTopPlayers:', topPlayersTest);
    }
    
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('🧪 Ошибка импорта db.js:', error);
    process.exit(1);
  });
}
