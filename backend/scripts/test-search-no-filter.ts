/**
 * Diagnostic: run vector search with NO filter to see if index returns any docs.
 * Run: npx ts-node scripts/test-search-no-filter.ts
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getDb } from '../src/db/client';
import { getPropertiesCollection } from '../src/db/collections';
import { embedQuery } from '../src/services/voyage';

async function main() {
  await getDb();
  const coll = await getPropertiesCollection();

  const queryText = 'quiet renovated natural light apartment';
  const queryVector = await embedQuery(queryText);

  const pipeline = [
    {
      $search: {
        index: 'property_search',
        vectorSearch: {
          path: 'embedding',
          queryVector,
          numCandidates: 100,
          limit: 20,
        },
      },
    },
    { $project: { _id: 1, title: 1, suburb: 1, bedrooms: 1, bathrooms: 1, parking: 1 } },
  ];

  const results = await coll.aggregate(pipeline).toArray();
  console.log('Vector search (no filter) returned', results.length, 'docs');
  results.slice(0, 5).forEach((d: any, i: number) => {
    console.log(`  ${i + 1}. ${d.title} | ${d.suburb} | ${d.bedrooms}b ${d.bathrooms}ba ${d.parking}p`);
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
