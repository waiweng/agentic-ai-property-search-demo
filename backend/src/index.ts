import path from 'path';
import dotenv from 'dotenv';
// Load .env from backend dir (when run as node dist/src/index.js, __dirname is backend/dist/src)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Load from project root when running via npm start from root (cwd is backend, so ../.env = root)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config(); // fallback to backend/.env or cwd
import express from 'express';
import cors from 'cors';
import { getDb, closeMongo, DB_NAME, isMongoConnected } from './db/client';
import { ensureIndexes } from './db/collections';
import { chatRouter } from './routes/chat';
import { sessionsRouter } from './routes/sessions';
import { preferencesRouter } from './routes/preferences';
import { searchRouter } from './routes/search';
import { placesRouter } from './routes/places';
import { marketRouter } from './routes/market';

const PORT = process.env.PORT || 4000;
const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'agentic-property-search-api',
    mongodb: isMongoConnected() ? 'connected' : 'disconnected',
  });
});

app.use('/api/chat', chatRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/search', searchRouter);
app.use('/api/places', placesRouter);
app.use('/api', marketRouter);

async function main() {
  try {
    await getDb();
    await ensureIndexes();
    console.log(`✅ MongoDB connected (db: ${DB_NAME}), indexes ensured`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('⚠️ MongoDB unavailable:', msg);
    console.error('   The API will start but data routes will return 503 until MongoDB is reachable.');
  }

  const basePort = Number(PORT) || 4000;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const p = basePort + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(p, () => {
          console.log(`🚀 API listening on http://localhost:${p}`);
          if (p !== basePort) {
            console.log(`   (Port ${basePort} was in use; using ${p}. To free it: lsof -ti:${basePort} | xargs kill -9)`);
          }
          resolve();
        });
        server.on('error', reject);
      });
      break;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
        continue;
      }
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await closeMongo();
  process.exit(0);
});
