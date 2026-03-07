import { Collection, MongoServerError } from 'mongodb';
import { getDb } from './client';

/** Create index; ignore "index already exists" / "index exists with different name" so startup does not fail. */
async function createIndexIfMissing(
  coll: Collection,
  spec: Parameters<Collection['createIndex']>[0],
  options?: Parameters<Collection['createIndex']>[1]
): Promise<void> {
  try {
    await coll.createIndex(spec, options);
  } catch (e) {
    if (e instanceof MongoServerError && (e.code === 85 || e.code === 86)) {
      // IndexOptionsConflict - index already exists (possibly with different name)
      return;
    }
    throw e;
  }
}

/** Drop an index by name if it exists; ignore if missing. */
async function dropIndexIfExists(coll: Collection, indexName: string): Promise<void> {
  try {
    await coll.dropIndex(indexName);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 27) {
      // IndexNotFound
      return;
    }
    throw e;
  }
}

export const COLLECTIONS = {
  PROPERTIES: 'properties',
  POIS: 'pois',
  MARKET_DATA: 'market_data',
  SESSIONS: 'sessions',
  THREADS: 'threads',
  PREFERENCES: 'preferences',
  CHECKPOINTS: 'graph_checkpoints',
  CHECKPOINT_WRITES: 'graph_checkpoint_writes',
  MEMORIES: 'memories',
} as const;

let _properties: Collection | null = null;
let _preferences: Collection | null = null;
let _pois: Collection | null = null;
let _marketData: Collection | null = null;
let _sessions: Collection | null = null;
let _threads: Collection | null = null;
let _checkpoints: Collection | null = null;
let _checkpointWrites: Collection | null = null;
let _memories: Collection | null = null;

export async function getPropertiesCollection(): Promise<Collection> {
  if (_properties) return _properties;
  const db = await getDb();
  _properties = db.collection(COLLECTIONS.PROPERTIES);
  return _properties;
}

export async function getPoisCollection(): Promise<Collection> {
  if (_pois) return _pois;
  const db = await getDb();
  _pois = db.collection(COLLECTIONS.POIS);
  return _pois;
}

export async function getMarketDataCollection(): Promise<Collection> {
  if (_marketData) return _marketData;
  const db = await getDb();
  _marketData = db.collection(COLLECTIONS.MARKET_DATA);
  return _marketData;
}

export async function getSessionsCollection(): Promise<Collection> {
  if (_sessions) return _sessions;
  const db = await getDb();
  _sessions = db.collection(COLLECTIONS.SESSIONS);
  return _sessions;
}

export async function getThreadsCollection(): Promise<Collection> {
  if (_threads) return _threads;
  const db = await getDb();
  _threads = db.collection(COLLECTIONS.THREADS);
  return _threads;
}

export async function getPreferencesCollection(): Promise<Collection> {
  if (_preferences) return _preferences;
  const db = await getDb();
  _preferences = db.collection(COLLECTIONS.PREFERENCES);
  return _preferences;
}

export async function getCheckpointsCollection(): Promise<Collection> {
  if (_checkpoints) return _checkpoints;
  const db = await getDb();
  _checkpoints = db.collection(COLLECTIONS.CHECKPOINTS);
  return _checkpoints;
}

export async function getCheckpointWritesCollection(): Promise<Collection> {
  if (_checkpointWrites) return _checkpointWrites;
  const db = await getDb();
  _checkpointWrites = db.collection(COLLECTIONS.CHECKPOINT_WRITES);
  return _checkpointWrites;
}

export async function getMemoriesCollection(): Promise<Collection> {
  if (_memories) return _memories;
  const db = await getDb();
  _memories = db.collection(COLLECTIONS.MEMORIES);
  return _memories;
}

/**
 * Ensure indexes exist.
 * - Vector index for properties: create in Atlas UI (e.g. property_search).
 * - Suburb autocomplete: create an Atlas Search index in Atlas UI named
 *   "property_suburb_autocomplete" with an autocomplete (Lucene) mapping on the
 *   "suburb" field; used by GET /api/places/autocomplete (see routes/places.ts).
 *
 * Index design follows MongoDB ESR (Equality, Sort, Range): equality fields first,
 * then sort fields, then range fields for efficient queries.
 */
export async function ensureIndexes(): Promise<void> {
  const pois = await getPoisCollection();
  await createIndexIfMissing(pois, { name: 1 }, { unique: true });
  await createIndexIfMissing(pois, { location: '2dsphere' });

  const sessions = await getSessionsCollection();
  await createIndexIfMissing(sessions, { userId: 1 });
  await createIndexIfMissing(sessions, { sessionId: 1 }, { unique: true });
  await createIndexIfMissing(sessions, { updatedAt: -1 });

  const threads = await getThreadsCollection();
  await createIndexIfMissing(threads, { sessionId: 1 }, { unique: true });

  const properties = await getPropertiesCollection();
  await createIndexIfMissing(
    properties,
    { suburb: 1, price: 1, bedrooms: 1, bathrooms: 1, parking: 1 },
    { name: 'suburb_price_bedrooms_bathrooms_parking' }
  );
  // Remove old suboptimal compound indexes (no price, wrong key order for our queries)
  await dropIndexIfExists(properties, 'bedrooms_1_bathrooms_1_parking_1_suburb_1');
  await dropIndexIfExists(properties, 'suburb_1_bedrooms_1_bathrooms_1_parking_1');

  const marketData = await getMarketDataCollection();
  await createIndexIfMissing(marketData, { suburb: 1, beds: 1, baths: 1, parking: 1 });

  const preferences = await getPreferencesCollection();
  await createIndexIfMissing(preferences, { userId: 1 }, { unique: true });

  const checkpoints = await getCheckpointsCollection();
  await createIndexIfMissing(
    checkpoints,
    { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1 },
    { unique: true }
  );
  await createIndexIfMissing(checkpoints, { thread_id: 1, checkpoint_ns: 1, checkpoint_id: -1 });

  const checkpointWrites = await getCheckpointWritesCollection();
  await createIndexIfMissing(
    checkpointWrites,
    { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1, task_id: 1, channel_idx: 1 },
    { unique: true }
  );

  const memories = await getMemoriesCollection();
  await createIndexIfMissing(memories, { userId: 1, sessionId: 1, createdAt: -1 });
  await createIndexIfMissing(memories, { userId: 1, createdAt: -1 });
}
