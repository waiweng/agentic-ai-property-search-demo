import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';

/**
 * Market data for Sydney suburbs – median unit/apartment price guides.
 * Sources: suburb reports and median unit prices (Carlingford ~$698k, Epping ~$800k,
 * Parramatta ~$620k, Telopea ~$780k). 3-bed typically 15–25% above 2-bed.
 * Multiple (beds, baths, parking) combinations per suburb to improve tool matching.
 */
const MARKET_RECORDS = [
  { suburb: 'Carlingford', beds: 2, baths: 2, parking: 1, avgPrice: 700_000, growthRatePct: 2, currency: 'AUD', history: [{ year: 2022, avgPrice: 672_000 }, { year: 2023, avgPrice: 686_000 }, { year: 2024, avgPrice: 700_000 }] },
  { suburb: 'Carlingford', beds: 2, baths: 1, parking: 1, avgPrice: 680_000, growthRatePct: 2, currency: 'AUD', history: [{ year: 2022, avgPrice: 652_000 }, { year: 2023, avgPrice: 666_000 }, { year: 2024, avgPrice: 680_000 }] },
  { suburb: 'Carlingford', beds: 3, baths: 2, parking: 1, avgPrice: 850_000, growthRatePct: 2.5, currency: 'AUD', history: [{ year: 2022, avgPrice: 810_000 }, { year: 2023, avgPrice: 830_000 }, { year: 2024, avgPrice: 850_000 }] },
  { suburb: 'Epping', beds: 2, baths: 2, parking: 1, avgPrice: 800_000, growthRatePct: 1.5, currency: 'AUD', history: [{ year: 2022, avgPrice: 775_000 }, { year: 2023, avgPrice: 788_000 }, { year: 2024, avgPrice: 800_000 }] },
  { suburb: 'Epping', beds: 2, baths: 1, parking: 1, avgPrice: 760_000, growthRatePct: 1.5, currency: 'AUD', history: [{ year: 2022, avgPrice: 738_000 }, { year: 2023, avgPrice: 749_000 }, { year: 2024, avgPrice: 760_000 }] },
  { suburb: 'Epping', beds: 3, baths: 2, parking: 1, avgPrice: 950_000, growthRatePct: 2, currency: 'AUD', history: [{ year: 2022, avgPrice: 915_000 }, { year: 2023, avgPrice: 932_000 }, { year: 2024, avgPrice: 950_000 }] },
  { suburb: 'Parramatta', beds: 2, baths: 2, parking: 1, avgPrice: 620_000, growthRatePct: 3, currency: 'AUD', history: [{ year: 2022, avgPrice: 585_000 }, { year: 2023, avgPrice: 602_000 }, { year: 2024, avgPrice: 620_000 }] },
  { suburb: 'Parramatta', beds: 2, baths: 1, parking: 1, avgPrice: 590_000, growthRatePct: 3, currency: 'AUD', history: [{ year: 2022, avgPrice: 558_000 }, { year: 2023, avgPrice: 574_000 }, { year: 2024, avgPrice: 590_000 }] },
  { suburb: 'Parramatta', beds: 3, baths: 2, parking: 1, avgPrice: 750_000, growthRatePct: 3.2, currency: 'AUD', history: [{ year: 2022, avgPrice: 705_000 }, { year: 2023, avgPrice: 727_000 }, { year: 2024, avgPrice: 750_000 }] },
  { suburb: 'Telopea', beds: 2, baths: 2, parking: 1, avgPrice: 780_000, growthRatePct: 1, currency: 'AUD', history: [{ year: 2022, avgPrice: 765_000 }, { year: 2023, avgPrice: 772_000 }, { year: 2024, avgPrice: 780_000 }] },
  { suburb: 'Telopea', beds: 2, baths: 1, parking: 1, avgPrice: 740_000, growthRatePct: 1, currency: 'AUD', history: [{ year: 2022, avgPrice: 726_000 }, { year: 2023, avgPrice: 733_000 }, { year: 2024, avgPrice: 740_000 }] },
  { suburb: 'Telopea', beds: 3, baths: 2, parking: 1, avgPrice: 920_000, growthRatePct: 1.2, currency: 'AUD', history: [{ year: 2022, avgPrice: 902_000 }, { year: 2023, avgPrice: 911_000 }, { year: 2024, avgPrice: 920_000 }] },
];

async function main() {
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.MARKET_DATA);
  await coll.deleteMany({});
  await coll.insertMany(MARKET_RECORDS);
  console.log(`Inserted ${MARKET_RECORDS.length} market_data records: Carlingford, Epping, Parramatta, Telopea (2b & 3b combinations).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
