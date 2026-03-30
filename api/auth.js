import { pool, generateAnonymousName } from './db.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    
    try {
        const { session_id, city = 'Не указан' } = req.body;

        if (!session_id) {
            return res.status(400).json({ success: false, error: 'Missing session_id' });
        }

        // Генерируем публичное имя из анонимного ID
        const cloudName = generateAnonymousName(session_id);

        // Фиксируем активность анонимного пользователя
        await pool.query(
            `INSERT INTO users_cloud (cloud_name, city, last_active) 
             VALUES ($1, $2, NOW()) 
             ON CONFLICT (cloud_name) 
             DO UPDATE SET last_active = NOW(), 
             city = CASE WHEN $2 != 'Не указан' THEN $2 ELSE users_cloud.city END`,
            [cloudName, city]
        );

        return res.json({ 
            success: true, 
            login: cloudName,
            isAnonymous: true 
        });

    } catch (error) {
        console.error('❌ Auth Error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
