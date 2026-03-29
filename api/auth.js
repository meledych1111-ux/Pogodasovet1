import { pool, generateAnonymousName } from './db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    
    const { login, hash, city, telegramId } = req.body;

    // Генерируем анонимное имя СРАЗУ. 
    // Оригинальный ID дальше этой переменной не пойдет.
    const effectiveId = telegramId || login;
    if (!effectiveId) return res.status(400).json({ error: 'No ID' });

    const cloudName = generateAnonymousName(effectiveId);

    try {
        // Сохраняем ТОЛЬКО облачное имя и город
        await pool.query(
            `INSERT INTO users_cloud (cloud_name, city, last_active) 
             VALUES ($1, $2, NOW()) 
             ON CONFLICT (cloud_name) 
             DO UPDATE SET 
                last_active = NOW(), 
                city = CASE WHEN $2 != 'Не указан' THEN $2 ELSE users_cloud.city END`,
            [cloudName, city || 'Не указан']
        );

        // Возвращаем фронтенду только облачное имя.
        return res.json({ success: true, login: cloudName });
    } catch (e) {
        console.error('Auth error:', e);
        return res.status(500).json({ error: 'DB Error' });
    }
}
