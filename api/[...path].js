import { createApp } from '../backend/app.js';
import { createTursoDatabase } from '../backend/database.js';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production.');
}

const database = await createTursoDatabase();
const app = createApp(database, { jwtSecret: process.env.JWT_SECRET });

export default app;
