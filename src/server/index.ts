import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';

const port = Number(process.env.PORT) || 8080;
const staticDir = fileURLToPath(new URL('../../dist/client', import.meta.url));
const s = await startServer({ port, staticDir });
console.log(`Pixel Poker listening on http://localhost:${s.port}`);
