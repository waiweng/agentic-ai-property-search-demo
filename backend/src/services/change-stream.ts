import { getPropertiesCollection } from '../db/collections';
import { getPreferencesCollection } from '../db/collections';
import type { PropertySummary } from './search';

export interface NewPropertyPayload {
  message: string;
  property: PropertySummary;
}

const NEW_LISTING_MESSAGE =
  "Hey there's new property listed in your saved area based on bedrooms, bathrooms, parking and within the price that's set—thought you might have a look.";

function docToSummary(doc: Record<string, unknown>): PropertySummary {
  const id = doc._id;
  return {
    _id: id != null && typeof id === 'object' && 'toString' in id ? (id as { toString(): string }).toString() : String(id),
    title: (doc.title as string) ?? '',
    description: (doc.description as string) ?? '',
    suburb: (doc.suburb as string) ?? '',
    price: typeof doc.price === 'number' ? doc.price : 0,
    bedrooms: typeof doc.bedrooms === 'number' ? doc.bedrooms : 0,
    bathrooms: typeof doc.bathrooms === 'number' ? doc.bathrooms : 0,
    parking: typeof doc.parking === 'number' ? doc.parking : 0,
    propertyType: (doc.propertyType as string) ?? '',
    location: undefined,
  };
}

function matchesPreferences(
  doc: { suburb?: string; bedrooms?: number; bathrooms?: number; parking?: number; price?: number },
  prefs: { suburbPreference?: string; bedrooms?: number; bathrooms?: number; parking?: number; priceMin?: number; priceMax?: number }
): boolean {
  if (doc.suburb !== prefs.suburbPreference) return false;
  if (doc.bedrooms !== prefs.bedrooms) return false;
  if (prefs.bathrooms != null && (doc.bathrooms ?? 0) < prefs.bathrooms) return false;
  if (prefs.parking != null && (doc.parking ?? 0) < prefs.parking) return false;
  if (prefs.priceMin != null && (doc.price ?? 0) < prefs.priceMin) return false;
  if (prefs.priceMax != null && (doc.price ?? 0) > prefs.priceMax) return false;
  return true;
}

export type OnNewPropertyNotify = (userId: string, payload: NewPropertyPayload) => void;

let streamClosed = false;

export async function startPropertiesChangeStream(onNotify: OnNewPropertyNotify): Promise<void> {
  try {
    const coll = await getPropertiesCollection();
    const prefsColl = await getPreferencesCollection();
    const pipeline = [{ $match: { operationType: 'insert' as const } }];
    const cursor = coll.watch(pipeline, { fullDocument: 'whenAvailable' });
    streamClosed = false;
    cursor.on('change', async (event: { fullDocument?: Record<string, unknown> }) => {
      if (streamClosed) return;
      const fullDocument = event.fullDocument;
      if (!fullDocument) return;
      const doc = {
        suburb: fullDocument.suburb as string | undefined,
        bedrooms: fullDocument.bedrooms as number | undefined,
        bathrooms: fullDocument.bathrooms as number | undefined,
        parking: fullDocument.parking as number | undefined,
        price: fullDocument.price as number | undefined,
      };
      const allPrefs = await prefsColl.find({}).toArray();
      for (const p of allPrefs) {
        const userId = p.userId as string;
        const prefs = {
          suburbPreference: p.suburbPreference as string | undefined,
          bedrooms: p.bedrooms as number | undefined,
          bathrooms: p.bathrooms as number | undefined,
          parking: p.parking as number | undefined,
          priceMin: p.priceMin as number | undefined,
          priceMax: p.priceMax as number | undefined,
        };
        if (matchesPreferences(doc, prefs)) {
          const property = docToSummary(fullDocument);
          onNotify(userId, { message: NEW_LISTING_MESSAGE, property });
        }
      }
    });
    cursor.on('error', (err) => {
      console.error('Change stream error:', err);
    });
    console.log('✅ Properties change stream started');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ Change stream not started (replica set required):', msg);
  }
}

export function stopPropertiesChangeStream(): void {
  streamClosed = true;
}
