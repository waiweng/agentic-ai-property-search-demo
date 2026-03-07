import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { getDb } from '../src/db/client';
import { COLLECTIONS } from '../src/db/collections';

const POIS = [
  { name: 'James Ruse Agricultural High School', type: 'school', lng: 151.0423207, lat: -33.7818819 },
  { name: 'James Ruse Public School', type: 'school', lng: 151.0423207, lat: -33.7818819 },
  { name: 'Epping High School', type: 'school', lng: 151.0817, lat: -33.7728 },
  { name: 'Carlingford Station', type: 'transport', lng: 151.0485, lat: -33.7819 },
  { name: 'Epping Station', type: 'transport', lng: 151.0817, lat: -33.7728 },
  { name: 'Parramatta Station', type: 'transport', lng: 151.0075, lat: -33.8152 },
  { name: 'Carlingford Court Shopping Village', type: 'shop', lng: 151.0485, lat: -33.7819 },
  { name: 'Carlingford', type: 'suburb', lng: 151.0485, lat: -33.7819 },
  { name: 'Epping', type: 'suburb', lng: 151.0817, lat: -33.7728 },
  { name: 'Telopea', type: 'suburb', lng: 151.035, lat: -33.788 },
  { name: 'Parramatta', type: 'suburb', lng: 151.0075, lat: -33.8152 },
];

async function main() {
  const db = await getDb();
  const coll = db.collection(COLLECTIONS.POIS);
  await coll.deleteMany({});
  const docs = POIS.map((p) => ({
    name: p.name,
    type: p.type,
    location: { type: 'Point', coordinates: [p.lng, p.lat] },
  }));
  await coll.insertMany(docs);
  console.log(`Inserted ${docs.length} POIs`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
