import { checkDatabaseConnection } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await checkDatabaseConnection();
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Database connected',
        time: result.time
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('Error checking database:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Database check failed'
    });
  }
}
