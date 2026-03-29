import { checkDatabaseConnection } from '../../lib/db.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  console.log('🔍 /api/check-db - Checking database connection');

  try {
    const result = await checkDatabaseConnection();
    
    const response = {
      success: result.success,
      status: result.success ? 'connected' : 'disconnected',
      message: result.message || 'Database connection check',
      timestamp: result.time || new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown'
    };

    console.log('🔍 Database check result:', response);
    return res.status(result.success ? 200 : 500).json(response);

  } catch (error) {
    console.error('❌ Error in check-db:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}