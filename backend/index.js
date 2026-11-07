import dotenv from 'dotenv';
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(projectRoot, '.env') });

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production.');
}
if (Boolean(process.env.RAZORPAY_KEY_ID) !== Boolean(process.env.RAZORPAY_KEY_SECRET)) {
    throw new Error('Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable Razorpay.');
}

const databasePath = process.env.DATABASE_PATH === ':memory:'
    ? ':memory:'
    : process.env.DATABASE_PATH
        ? resolve(projectRoot, process.env.DATABASE_PATH)
        : undefined;
const db = createDatabase(databasePath);
const app = createApp(db);
const frontendBuildPath = resolve(projectRoot, 'frontend', 'dist');
app.use(express.static(frontendBuildPath, { index: false }));
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(resolve(frontendBuildPath, 'index.html'), error => {
        if (error) next(error);
    });
});

const port = Number(process.env.PORT || process.env.API_PORT || 3001);

app.listen(port, () => {
    console.log(`Repeato listening on port ${port}`);
});
