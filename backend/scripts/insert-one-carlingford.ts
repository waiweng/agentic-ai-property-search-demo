/**
 * Insert a single property in Carlingford matching default preferences (2 bed, 2 bath, 1 parking)
 * to test the change stream notification. Run while dev server is running and user is logged in.
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import { getDb } from '../src/db/client';
import { getPropertiesCollection } from '../src/db/collections';
import { embedDocuments } from '../src/services/voyage';

async function main() {
  const text = '2 Bed Apartment in Carlingford. New listing. Natural light.';
  const [embedding] = await embedDocuments([text]);
  const coll = await getPropertiesCollection();
  const doc = {
    title: '2 Bed Apartment in Carlingford (new listing)',
    description: 'New listing. Natural light. Test for change stream.',
    suburb: 'Carlingford',
    price: 700_000,
    bedrooms: 2,
    bathrooms: 2,
    parking: 1,
    propertyType: 'apartment',
    location: { type: 'Point' as const, coordinates: [151.0485, -33.7819] },
    embedding,
    createdAt: new Date(),
  };
  const result = await coll.insertOne(doc);
  console.log('Inserted 1 property in Carlingford:', result.insertedId);
  console.log('If the dev server is running and you are logged in, you should see the new-listing message in the UI.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
