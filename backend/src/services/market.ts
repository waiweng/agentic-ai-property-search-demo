import { getMarketDataCollection } from '../db/collections';

export interface MarketEstimate {
  suburb: string;
  beds: number;
  baths: number;
  parking: number;
  avgPrice: number;
  growthRatePct: number;
  currency: string;
  history?: Array<{ year: number; avgPrice: number }>;
}

/**
 * Get market estimate from market_data collection.
 * Tries exact match (suburb, beds, baths, parking) first, then fallback to same suburb + beds
 * so "two bedroom apartment" still gets a guide when baths/parking differ slightly.
 */
export async function getMarketEstimate(
  suburb: string,
  beds: number,
  baths: number,
  parking: number
): Promise<MarketEstimate | null> {
  const coll = await getMarketDataCollection();
  const sub = suburb.trim();
  const re = new RegExp(`^${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  let doc = await coll.findOne({ suburb: re, beds, baths, parking });
  if (!doc) {
    doc = await coll.findOne({ suburb: re, beds });
  }
  if (!doc) return null;
  return {
    suburb: doc.suburb,
    beds: doc.beds,
    baths: doc.baths,
    parking: doc.parking,
    avgPrice: doc.avgPrice,
    growthRatePct: doc.growthRatePct,
    currency: doc.currency || 'AUD',
    history: doc.history,
  };
}
