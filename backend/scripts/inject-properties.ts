import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';
import { embedDocuments } from '../src/services/voyage';

const SUBURBS = [
  { name: 'Carlingford', lngMin: 151.03, lngMax: 151.06, latMin: -33.80, latMax: -33.76 },
  { name: 'Telopea', lngMin: 151.02, lngMax: 151.05, latMin: -33.81, latMax: -33.78 },
  { name: 'Parramatta', lngMin: 150.99, lngMax: 151.02, latMin: -33.83, latMax: -33.80 },
  { name: 'Epping', lngMin: 151.06, lngMax: 151.10, latMin: -33.78, latMax: -33.76 },
];

const PHRASES = [
  'Plenty of natural lighting.',
  'North-facing balcony.',
  'Recently renovated.',
  'Move-in ready.',
  'Close to transport.',
  'Close to schools.',
  'Walk to shops.',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDesc(): string {
  const n = randomInt(2, 5);
  const used = new Set<number>();
  const parts: string[] = [];
  while (parts.length < n) {
    const i = Math.floor(Math.random() * PHRASES.length);
    if (used.has(i)) continue;
    used.add(i);
    parts.push(PHRASES[i]);
  }
  return parts.join(' ');
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function main() {
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.PROPERTIES);
  await coll.deleteMany({});

  const MAX = 200;
  const propertyTypes = ['apartment'];
  const docs: Array<{
    title: string;
    description: string;
    suburb: string;
    price: number;
    bedrooms: number;
    bathrooms: number;
    parking: number;
    propertyType: string;
    location: { type: string; coordinates: number[] };
    createdAt: Date;
  }> = [];

  for (let i = 0; i < MAX; i++) {
    const suburb = pick(SUBURBS);
    const lng = randomInRange(suburb.lngMin, suburb.lngMax);
    const lat = randomInRange(suburb.latMin, suburb.latMax);
    const bedrooms = randomInt(1, 3);
    const bathrooms = Math.max(1, bedrooms - randomInt(0, 1));
    const parking = randomInt(0, 2);
    const basePrice = 500000 + bedrooms * 80000 + randomInt(0, 150000);
    const title = `${bedrooms} Bed Apartment in ${suburb.name}`;
    const description = randomDesc();
    docs.push({
      title,
      description,
      suburb: suburb.name,
      price: basePrice,
      bedrooms,
      bathrooms,
      parking,
      propertyType: pick(propertyTypes),
      location: { type: 'Point', coordinates: [lng, lat] },
      createdAt: new Date(),
    });
  }

  const BATCH = 5;
  const DELAY_MS = 25000; // Voyage free tier 3 RPM; wait between batches
  console.log('Waiting 60s for Voyage rate-limit window...');
  await new Promise((r) => setTimeout(r, 60000));
  for (let i = 0; i < docs.length; i += BATCH) {
    if (i > 0) {
      console.log(`Waiting ${DELAY_MS / 1000}s before next batch (Voyage rate limit)...`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    const batch = docs.slice(i, i + BATCH);
    const texts = batch.map((d) => `${d.title} ${d.description} ${d.suburb}`);
    const embeddings = await embedDocuments(texts);
    batch.forEach((d, j) => {
      (d as any).embedding = embeddings[j];
    });
    console.log(`Embedded ${i + batch.length}/${docs.length} properties`);
  }

  await coll.insertMany(docs);
  console.log(`Inserted ${docs.length} properties with embeddings`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
