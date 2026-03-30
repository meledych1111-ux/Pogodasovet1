import { getOrRegisterPin, saveUserCity } from './db.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    
    try {
        const { pin, city = 'Не указан' } = req.body;

        if (!pin) {
            return res.status(400).json({ success: false, error: 'Введите ПИН-код' });
        }

        // Проверяем ПИН в базе и получаем анонимное имя
        const { cloudName } = await getOrRegisterPin(pin);

        // Обновляем активность и город
        await saveUserCity(cloudName, city);

        return res.json({ 
            success: true, 
            login: cloudName,
            pin: pin
        });

    } catch (error) {
        console.error('❌ Auth Error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка ПИН-кода' });
    }
}
