/**
 * One-off: update existing "2 Bed Apartment near James Ruse" documents so their
 * location is closer to James Ruse Public School (e.g. for the $759,169 listing).
 *
 * Run: npm run update:james-ruse-location
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';

const JAMES_RUSE_SCHOOL = { lng: 151.0423207, lat: -33.7818819 };

async function main() {
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.PROPERTIES);

  const filter = { title: '2 Bed Apartment near James Ruse' };
  const update = {
    $set: {
      location: {
        type: 'Point',
        coordinates: [
          JAMES_RUSE_SCHOOL.lng + 0.0001,
          JAMES_RUSE_SCHOOL.lat + 0.00005,
        ],
      },
    },
  };

  const result = await coll.updateMany(filter, update);
  console.log(
    `Updated ${result.modifiedCount} document(s) "2 Bed Apartment near James Ruse" to location closer to James Ruse Public School.`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
