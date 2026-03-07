/**
 * Ensures the properties collection exists with at least one document
 * that has an "embedding" field (1024 dims) so you can create the Atlas vector index.
 * Run: npx ts-node scripts/seed-properties-collection.ts
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';
import { embedDocuments } from '../src/services/voyage';

async function main() {
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.PROPERTIES);

  const text = '2 Bed Apartment in Carlingford. Plenty of natural lighting. Recently renovated.';
  const [embedding] = await embedDocuments([text]);

  const seed = {
    title: '2 Bed Apartment in Carlingford',
    description: 'Plenty of natural lighting. Recently renovated.',
    suburb: 'Carlingford',
    price: 650000,
    bedrooms: 2,
    bathrooms: 2,
    parking: 1,
    propertyType: 'apartment',
    location: { type: 'Point', coordinates: [151.0485, -33.7819] },
    embedding,
    createdAt: new Date(),
  };

  await coll.insertOne(seed);
  console.log('Inserted 1 seed property with embedding. Collection is ready for vector index.');
  const count = await coll.countDocuments();
  console.log('Total properties in collection:', count);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
