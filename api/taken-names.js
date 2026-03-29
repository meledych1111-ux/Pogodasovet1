import { getTakenLogins } from './db.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const taken = await getTakenLogins();
        return res.status(200).json(taken);
    } catch (error) {
        return res.status(500).json([]);
    }
}
