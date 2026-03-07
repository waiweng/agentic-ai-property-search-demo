import { getMarketDataCollection, getPoisCollection } from '../db/collections';

const CACHE_MS = 60_000; // 1 minute
let cachedSuburbs: string[] | null = null;
let cachedPlaceNames: string[] | null = null;
let cacheTimeSuburbs = 0;
let cacheTimePlaces = 0;

/**
 * Returns suburb names that have market_data (price guides). Use for intent detection
 * and suburb extraction so adding new suburbs to the DB automatically works.
 */
export async function getSupportedSuburbs(): Promise<string[]> {
  if (cachedSuburbs !== null && Date.now() - cacheTimeSuburbs < CACHE_MS) {
    return cachedSuburbs;
  }
  const coll = await getMarketDataCollection();
  const list = await coll.distinct('suburb', {});
  const normalized = (list as string[])
    .filter((s) => s != null && String(s).trim())
    .map((s) => String(s).trim());
  cachedSuburbs = [...new Set(normalized)];
  cacheTimeSuburbs = Date.now();
  return cachedSuburbs;
}

/**
 * Returns place names from POIs (e.g. "Epping Station", "Carlingford Village") for
 * matching "near X" in user messages. Use with getSupportedSuburbs for full coverage.
 */
export async function getSupportedPlaceNames(): Promise<string[]> {
  if (cachedPlaceNames !== null && Date.now() - cacheTimePlaces < CACHE_MS) {
    return cachedPlaceNames;
  }
  const coll = await getPoisCollection();
  const list = await coll.distinct('name', {});
  const normalized = (list as string[])
    .filter((s) => s != null && String(s).trim())
    .map((s) => String(s).trim());
  cachedPlaceNames = [...new Set(normalized)];
  cacheTimePlaces = Date.now();
  return cachedPlaceNames;
}

/** Escape special regex characters in a string for use in RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a RegExp that matches text containing any of the given suburb names (case-insensitive).
 * Use for "suburb + price intent" detection. Returns null if list is empty.
 */
export function suburbListToRegex(suburbs: string[]): RegExp | null {
  if (suburbs.length === 0) return null;
  const pattern = suburbs.map((s) => escapeRegex(s)).join('|');
  return new RegExp(`(${pattern})`, 'i');
}
