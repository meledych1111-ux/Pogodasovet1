import { pool, generateAnonymousName } from './db.js';
import crypto from 'crypto';

function generateAuthHash(id) {
    const secret = process.env.BOT_TOKEN || 'fallback_secret';
    return crypto.createHash('sha256').update(String(id) + secret).digest('hex').substring(0, 16);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    
    // tg_id приходит только из бота для проверки
    const { login, hash, city, tg_id } = req.body;

    // Если мы заходим из бота, у нас есть tg_id и hash
    if (tg_id && hash) {
        const expected = generateAuthHash(tg_id);
        if (hash === expected) {
            const cloudName = generateAnonymousName(tg_id);
            try {
                await pool.query(
                    `INSERT INTO users_cloud (cloud_name, city, last_active) 
                     VALUES ($1, $2, NOW()) 
                     ON CONFLICT (cloud_name) 
                     DO UPDATE SET last_active = NOW(), 
                     city = CASE WHEN $2 != 'Не указан' THEN $2 ELSE users_cloud.city END`,
                    [cloudName, city || 'Не указан']
                );
                return res.json({ success: true, login: cloudName });
            } catch (e) { console.error(e); }
        }
    }

    // Если автоматический вход не сработал, пробуем по логину (для ручного входа)
    if (login) {
        return res.json({ success: true, login });
    }

    return res.status(401).json({ success: false, error: 'Авторизация не удалась' });
}
