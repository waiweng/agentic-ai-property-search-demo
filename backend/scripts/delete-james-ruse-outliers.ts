/**
 * Delete properties that are too close to James Ruse Public School (outliers "in" the school).
 * Keeps only properties that are "around" (not on) the school.
 *
 * Run: npm run delete:james-ruse-outliers
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';

const JAMES_RUSE_SCHOOL = { lng: 151.0423207, lat: -33.7818819 };
// Delete documents within ~250m of the school (0.0025 deg ≈ 250m)
const MIN_DISTANCE_DEG = 0.0025;

function distanceDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng2 - lng1) ** 2 + (lat2 - lat1) ** 2);
}

async function main() {
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.PROPERTIES);

  const cursor = coll.find({
    title: '2 Bed Apartment near James Ruse',
    location: { $exists: true, $ne: null },
  });

  let deleted = 0;
  for await (const doc of cursor) {
    const loc = doc.location;
    if (!loc?.coordinates || !Array.isArray(loc.coordinates) || loc.coordinates.length < 2) continue;
    const [lng, lat] = loc.coordinates;
    const dist = distanceDeg(JAMES_RUSE_SCHOOL.lng, JAMES_RUSE_SCHOOL.lat, lng, lat);
    if (dist < MIN_DISTANCE_DEG) {
      await coll.deleteOne({ _id: doc._id });
      deleted++;
      console.log(`Deleted outlier: ${doc.title} · $${doc.price} (${dist.toFixed(4)} deg from school)`);
    }
  }

  console.log(`Deleted ${deleted} document(s) too close to James Ruse Public School.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
