import { checkDatabaseConnection, pool } from './db.js';

export default async function handler(req, res) {
  console.log('🔍 API: /api/check-db - проверка базы данных');
  console.log('🔍 Метод:', req.method);
  
  // Устанавливаем заголовки CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка OPTIONS запросов
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
      
      const client = await pool.connect();
      
      try {
        // Получаем информацию о таблицах
        const tablesQuery = await client.query(`
          SELECT 
            table_name,
            table_type
          FROM information_schema.tables 
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);
        
        // Получаем статистику по таблицам
        const tablesInfo = await Promise.all(
          tablesQuery.rows.map(async (table) => {
            try {
              const countResult = await client.query(
                `SELECT COUNT(*) FROM "${table.table_name}"`
              );
              return {
                name: table.table_name,
                type: table.table_type,
                row_count: parseInt(countResult.rows[0]?.count) || 0
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
          const statsResult = await client.query(`
            SELECT 
              COUNT(*) as total_games,
              COUNT(DISTINCT user_id) as unique_players,
              COALESCE(MAX(score), 0) as max_score,
              COALESCE(AVG(score), 0) as avg_score
            FROM game_scores 
            WHERE game_type = 'tetris'
          `);
          
          gameStats = {
            total_games: parseInt(statsResult.rows[0]?.total_games) || 0,
            unique_players: parseInt(statsResult.rows[0]?.unique_players) || 0,
            max_score: parseInt(statsResult.rows[0]?.max_score) || 0,
            avg_score: parseFloat(statsResult.rows[0]?.avg_score) || 0
          };
        } catch (statsError) {
          console.log('⚠️ Не удалось получить статистику игр:', statsError.message);
          gameStats = { error: statsError.message };
        }
        
        // Получаем количество пользователей
        let usersCount = 0;
        try {
          const usersResult = await client.query(
            'SELECT COUNT(*) FROM users'
          );
          usersCount = parseInt(usersResult.rows[0]?.count) || 0;
        } catch (usersError) {
          console.log('⚠️ Не удалось получить количество пользователей:', usersError.message);
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
            node_version: process.version
          },
          database_info: {
            tables: tablesInfo,
            total_tables: tablesInfo.length,
            game_stats: gameStats,
            total_users: usersCount,
            masked_connection_string: maskedUrl
          },
          recommendations: tablesInfo.length === 0 
            ? 'Таблицы не найдены. Возможно, требуется миграция.'
            : 'Все таблицы присутствуют.'
        };
        
        console.log('✅ Проверка завершена успешно');
        console.log('📊 Статистика:', {
          tables: tablesInfo.length,
          games: gameStats?.total_games || 0,
          users: usersCount
        });
        
        return res.status(200).json(response);
        
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
          simple_info: {
            connected: true,
            response_time: connectionResult.time
          }
        });
      } finally {
        client.release();
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
            node_env: process.env.NODE_ENV || 'development'
          }
        },
        troubleshooting: [
          '1. Проверьте переменную окружения DATABASE_URL в Vercel',
          '2. Убедитесь, что база данных PostgreSQL запущена и доступна',
          '3. Проверьте, не истек ли срок действия базы данных (если используется бесплатный план)',
          '4. Проверьте логи Vercel для подробной информации об ошибке'
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
      troubleshooting: [
        '1. Проверьте логи Vercel для деталей',
        '2. Убедитесь, что все зависимости установлены',
        '3. Проверьте конфигурацию PostgreSQL',
        '4. Свяжитесь с поддержкой Vercel'
      ]
    };
    
    return res.status(500).json(errorResponse);
  }
}

// Функция для тестирования подключения (для использования в других модулях)
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
