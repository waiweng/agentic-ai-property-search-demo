/**
 * Count docs in properties collection (no search).
 * Run: npx ts-node scripts/test-count.ts
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getDb } from '../src/db/client';
import { getPropertiesCollection } from '../src/db/collections';

async function main() {
  await getDb();
  const coll = await getPropertiesCollection();
  const total = await coll.countDocuments();
  const withEmbedding = await coll.countDocuments({ embedding: { $exists: true } });
  const sample = await coll.findOne({}, { projection: { title: 1, suburb: 1, bedrooms: 1 } });
  console.log('Total properties:', total);
  console.log('With embedding:', withEmbedding);
  console.log('Sample doc:', JSON.stringify(sample));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
