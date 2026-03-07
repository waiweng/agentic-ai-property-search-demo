/**
 * Seed properties around James Ruse Public School with embeddings.
 * - 50 mixed 1–3 bed apartments (random)
 * - 25 two-bedroom apartments with "quiet, renovated, natural light" style descriptions
 * Does NOT delete existing properties. Run after inject:properties if you want both.
 *
 * Run: npm run inject:james-ruse
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';
import { embedDocuments } from '../src/services/voyage';

// James Ruse Public School (from inject-pois.ts): 151.0423207, -33.7818819
const JAMES_RUSE_SCHOOL = { lng: 151.0423207, lat: -33.7818819 };
// Box AROUND the school (~400m–1.2km away), not on the school itself (mock "near" not "in")
const JAMES_RUSE_BOX = {
  name: 'Near James Ruse',
  lngMin: 151.035,
  lngMax: 151.040,
  latMin: -33.786,
  latMax: -33.783,
};
// Second band east/south so we have variety around (not only west)
const JAMES_RUSE_BOX_2 = {
  name: 'Near James Ruse',
  lngMin: 151.044,
  lngMax: 151.050,
  latMin: -33.781,
  latMax: -33.778,
};

const PHRASES = [
  'Quiet location.',
  'Nicely renovated.',
  'Natural light throughout.',
  'Close to James Ruse Public School.',
  'Plenty of natural lighting.',
  'Recently renovated.',
  'Move-in ready.',
  'Close to schools.',
  'Peaceful street.',
  'Bright and airy.',
  'Modern kitchen.',
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

  const COUNT = 50;
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

  const boxes = [JAMES_RUSE_BOX, JAMES_RUSE_BOX_2];
  for (let i = 0; i < COUNT; i++) {
    const box = pick(boxes);
    const lng = randomInRange(box.lngMin, box.lngMax);
    const lat = randomInRange(box.latMin, box.latMax);
    const bedrooms = randomInt(1, 3);
    const bathrooms = Math.max(1, bedrooms - randomInt(0, 1));
    const parking = randomInt(0, 2);
    const basePrice = 500000 + bedrooms * 80000 + randomInt(0, 150000);
    const title = `${bedrooms} Bed Apartment near James Ruse`;
    const description = randomDesc();
    docs.push({
      title,
      description,
      suburb: box.name,
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
    console.log(`Waiting 60s for Voyage rate-limit window...`);
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

  // Add 25 two-bedroom apartments with descriptions that match "quiet, nicely renovated, natural light"
  const TWO_BED_PHRASES = [
    'Quiet location. Nicely renovated. Natural light throughout.',
    'Nicely renovated. Plenty of natural lighting. Quiet street.',
    'Quiet, nicely renovated apartment. Full of natural light.',
    'Recently renovated. Bright and airy. Close to James Ruse Public School.',
    'Natural light throughout. Quiet. Move-in ready.',
    'Quiet location. Natural light. Modern kitchen.',
    'Nicely renovated. Peaceful street. Plenty of natural lighting.',
    'Bright and airy. Quiet. Close to James Ruse Public School.',
    'Quiet, renovated. Natural light. Walk to shops.',
    'Plenty of natural lighting. Nicely renovated. Quiet.',
    'Natural light. Quiet location. Recently renovated.',
    'Nicely renovated. Natural light throughout. Peaceful.',
    'Quiet apartment. Natural light. Close to schools.',
    'Renovated. Quiet. Full of natural light.',
    'Natural light. Quiet street. Nicely renovated.',
    'Quiet, bright. Nicely renovated. Natural light.',
    'Plenty of natural light. Quiet. Recently renovated.',
    'Nicely renovated. Quiet. Natural light throughout.',
    'Quiet location. Natural light. Renovated kitchen.',
    'Natural light throughout. Quiet. Close to James Ruse.',
    'Quiet, renovated. Natural light. Peaceful street.',
    'Bright. Quiet. Nicely renovated. Natural light.',
    'Natural light. Quiet. Nicely renovated apartment.',
    'Quiet. Natural light. Renovated. Close to James Ruse Public School.',
    'Nicely renovated. Quiet. Natural light. Move-in ready.',
  ];

  const twoBedCount = 25;
  for (let i = 0; i < twoBedCount; i++) {
    const box = pick(boxes);
    const lng = randomInRange(box.lngMin, box.lngMax);
    const lat = randomInRange(box.latMin, box.latMax);
    const description = TWO_BED_PHRASES[i % TWO_BED_PHRASES.length];
    const price = 580000 + randomInt(0, 120000);
    docs.push({
      title: '2 Bed Apartment near James Ruse',
      description,
      suburb: box.name,
      price,
      bedrooms: 2,
      bathrooms: 2,
      parking: randomInt(0, 2),
      propertyType: 'apartment',
      location: { type: 'Point', coordinates: [lng, lat] },
      createdAt: new Date(),
    });
  }

  // Generate embeddings for the two-bed batch (they were just pushed to docs)
  const twoBedBatch = docs.slice(COUNT, docs.length);
  if (twoBedBatch.length > 0) {
    if (docs.length > BATCH) {
      console.log('Waiting 60s before embedding two-bed batch...');
      await new Promise((r) => setTimeout(r, 60000));
    }
    for (let i = 0; i < twoBedBatch.length; i += BATCH) {
      if (i > 0) {
        console.log(`Waiting ${DELAY_MS / 1000}s before next batch...`);
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      const batch = twoBedBatch.slice(i, i + BATCH);
      const texts = batch.map((d) => `${d.title} ${d.description} ${d.suburb}`);
      const embeddings = await embedDocuments(texts);
      batch.forEach((d, j) => {
        (d as Record<string, unknown>).embedding = embeddings[j];
      });
      console.log(`Embedded two-bed ${i + batch.length}/${twoBedBatch.length}`);
    }
  }

  await coll.insertMany(docs);
  console.log(`Inserted ${docs.length} properties with embeddings (around James Ruse Public School, including ${twoBedCount} two-bed).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
