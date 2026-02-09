// api/check-db.js
import { checkDatabaseConnection, pool, diagnoseConnection } from './db.js';

export default async function handler(req, res) {
  console.log('🔍 API: /api/check-db - проверка базы данных');
  console.log('🔍 Метод:', req.method);
  
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
            'game_progress'
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
              WHERE tablename IN ('user_sessions', 'game_scores', 'game_progress')
              AND schemaname = 'public'
              ORDER BY tablename, indexname
            `);
            
            indexesInfo.indexes = indexesQuery.rows;
          } catch (indexError) {
            indexesInfo.error = indexError.message;
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
              indexes: indexesInfo
            },
            system_status: {
              database: missingTables.length === 0 ? 'ok' : 'warning',
              structure: gameStats?.error ? 'error' : 'ok',
              data_integrity: gameStats?.total_games > 0 ? 'has_data' : 'no_data'
            },
            recommendations: missingTables.length > 0 
              ? [`Отсутствуют таблицы: ${missingTables.join(', ')}. Запустите инициализацию БД.`]
              : ['✅ Все таблицы присутствуют.'],
            
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
            unique_players: response.database_info.game_stats?.unique_players || 0
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

// Если файл запущен напрямую, выполнить тест
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Запуск теста check-db.js');
  console.log('⚠️ Внимание: Этот файл должен запускаться через API route, не напрямую');
  
  // Для тестирования напрямую
  import('./db.js').then(async (db) => {
    const result = await db.checkDatabaseConnection();
    console.log('🧪 Результат теста:', result);
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('🧪 Ошибка импорта db.js:', error);
    process.exit(1);
  });
}
