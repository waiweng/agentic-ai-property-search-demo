/**
 * Insert the seed document from seed-doc.json into properties collection.
 * Use this if the collection exists but is empty - loads .env from project root.
 * Run from backend: npm run seed:from-json
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';

async function main() {
  const jsonPath = path.resolve(__dirname, 'seed-doc.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const docs = JSON.parse(raw);
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('seed-doc.json must be a non-empty array');
  }
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.PROPERTIES);
  for (const d of docs) {
    if (d.createdAt && typeof d.createdAt === 'string') d.createdAt = new Date(d.createdAt);
  }
  await coll.insertMany(docs);
  console.log('Inserted', docs.length, 'seed document(s). Collection is ready for vector index.');
  const count = await coll.countDocuments();
  console.log('Total properties:', count);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
