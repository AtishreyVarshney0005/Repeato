import { randomBytes } from 'node:crypto';
import { createApp } from '../backend/app.js';
import { createDatabase } from '../backend/database.js';

const database = createDatabase(process.env.DATABASE_PATH || '/tmp/repeato.sqlite');
const app = createApp(database, {
    jwtSecret: process.env.JWT_SECRET || randomBytes(32).toString('hex')
});

export default app;
