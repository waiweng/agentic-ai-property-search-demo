/**
 * Test search pipeline: lexical prefilters (near + range) + semantic vectorSearch + Voyage rerank.
 * Example query: "quiet, nicely renovated, natural light apartment close to James Ruse Public School"
 *
 * Run: npm run test:search
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { getDb } from '../src/db/client';
import { getPoiCoordinates } from '../src/services/poi';
import { runSearch } from '../src/services/search';

const TEST_QUERY =
  'quiet, nicely renovated, natural light apartment that is close to james ruse public school';

async function main() {
  await getDb();

  const poi = await getPoiCoordinates('James Ruse Public School');
  const centre = poi
    ? { lng: poi.lng, lat: poi.lat, radiusKm: 5 }
    : { lng: 151.0485, lat: -33.7819, radiusKm: 5 };

  console.log('Query:', TEST_QUERY);
  console.log('Geo centre:', centre, poi ? `(from POI: ${poi.name})` : '(default Carlingford)');
  console.log('Structured: 2 bed, 2 bath, 1 parking (defaults)\n');

  const { properties, toolCallsLog } = await runSearch(TEST_QUERY, centre, {
    bedrooms: 2,
    bathrooms: 2,
    parking: 1,
  });

  console.log('Tool log:', toolCallsLog.join(' → '));
  console.log('\nTop results:', properties.length);
  properties.forEach((p, i) => {
    console.log(
      `  ${i + 1}. ${p.title} | ${p.bedrooms}b ${p.bathrooms}ba ${p.parking}p | ${p.suburb} | $${p.price ?? '—'}`
    );
    if (p.description) console.log('     ', p.description.slice(0, 120) + (p.description.length > 120 ? '...' : ''));
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
