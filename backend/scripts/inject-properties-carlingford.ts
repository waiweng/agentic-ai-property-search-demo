/**
 * Seed properties within ~2 km of James Ruse Agricultural High School (Carlingford).
 * Does NOT delete existing properties.
 * Run: npm run inject:carlingford
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';
import { embedDocuments } from '../src/services/voyage';

// James Ruse Agricultural High School, Carlingford: 151.0423207, -33.7818819; ~2km box
const CARLINGFORD_BOX = {
  name: 'Carlingford',
  lngMin: 151.022,
  lngMax: 151.063,
  latMin: -33.800,
  latMax: -33.764,
};

const PHRASES = [
  'Quiet location.',
  'Nicely renovated.',
  'Natural light throughout.',
  'Close to James Ruse Agricultural High School.',
  'Plenty of natural lighting.',
  'Recently renovated.',
  'Move-in ready.',
  'Close to schools.',
  'Peaceful street.',
  'Bright and airy.',
  'Modern kitchen.',
  'Walk to Carlingford Station.',
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

  const COUNT = 60;
  const suburb = CARLINGFORD_BOX;
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

  for (let i = 0; i < COUNT; i++) {
    const lng = randomInRange(suburb.lngMin, suburb.lngMax);
    const lat = randomInRange(suburb.latMin, suburb.latMax);
    const bedrooms = randomInt(1, 4);
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
      propertyType: 'apartment',
      location: { type: 'Point', coordinates: [lng, lat] },
      createdAt: new Date(),
    });
  }

  const BATCH = 5;
  const DELAY_MS = 25000;
  console.log(`Generating embeddings for ${COUNT} properties (Voyage)...`);
  if (docs.length > BATCH) {
    console.log('Waiting 60s for Voyage rate-limit window...');
    await new Promise((r) => setTimeout(r, 60000));
  }
  for (let i = 0; i < docs.length; i += BATCH) {
    if (i > 0) {
      console.log(`Waiting ${DELAY_MS / 1000}s before next batch...`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    const batch = docs.slice(i, i + BATCH);
    const texts = batch.map((d) => `${d.title} ${d.description} ${d.suburb}`);
    const embeddings = await embedDocuments(texts);
    batch.forEach((d, j) => {
      (d as Record<string, unknown>).embedding = embeddings[j];
    });
    console.log(`Embedded ${i + batch.length}/${docs.length}`);
  }

  await coll.insertMany(docs);
  console.log(`Inserted ${docs.length} properties (Carlingford, within ~2km of James Ruse Agricultural High School).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
