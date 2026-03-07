import { Router } from 'express';
import { getPreferencesCollection } from '../db/collections';
import { getPoiCoordinates, getDefaultCentre } from '../services/poi';
import { runSearch } from '../services/search';

const DEFAULT_PREFERENCES = {
  bedrooms: 2,
  bathrooms: 2,
  parking: 1,
  suburbPreference: 'Carlingford',
  referencePoint: 'Carlingford town centre',
  defaultRadiusKm: 5,
  priceMin: undefined as number | undefined,
  priceMax: undefined as number | undefined,
};

export type PreferencesForAgent = {
  bedrooms: number;
  bathrooms: number;
  parking: number;
  suburbPreference: string;
  defaultRadiusKm: number;
};

/** Load user preferences for the agent (used by chat to inject saved prefs into the prompt). */
export async function getPreferencesForAgent(userId: string): Promise<PreferencesForAgent | null> {
  const coll = await getPreferencesCollection();
  const doc = await coll.findOne({ userId });
  if (!doc) return null;
  return {
    bedrooms: doc.bedrooms ?? DEFAULT_PREFERENCES.bedrooms,
    bathrooms: doc.bathrooms ?? DEFAULT_PREFERENCES.bathrooms,
    parking: doc.parking ?? DEFAULT_PREFERENCES.parking,
    suburbPreference: doc.suburbPreference ?? DEFAULT_PREFERENCES.suburbPreference,
    defaultRadiusKm: doc.defaultRadiusKm ?? DEFAULT_PREFERENCES.defaultRadiusKm,
  };
}

export const preferencesRouter = Router();

preferencesRouter.get('/', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'demo-buyer';
    const coll = await getPreferencesCollection();
    const doc = await coll.findOne({ userId });
    const prefs = doc
      ? {
          bedrooms: doc.bedrooms ?? DEFAULT_PREFERENCES.bedrooms,
          bathrooms: doc.bathrooms ?? DEFAULT_PREFERENCES.bathrooms,
          parking: doc.parking ?? DEFAULT_PREFERENCES.parking,
          suburbPreference: doc.suburbPreference ?? DEFAULT_PREFERENCES.suburbPreference,
          referencePoint: doc.referencePoint ?? DEFAULT_PREFERENCES.referencePoint,
          defaultRadiusKm: doc.defaultRadiusKm ?? DEFAULT_PREFERENCES.defaultRadiusKm,
          priceMin: doc.priceMin,
          priceMax: doc.priceMax,
        }
      : { ...DEFAULT_PREFERENCES };
    res.json(prefs);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

preferencesRouter.post('/', async (req, res) => {
  try {
    const userId = (req.body?.userId as string) || 'demo-buyer';
    const {
      bedrooms,
      bathrooms,
      parking,
      suburbPreference,
      referencePoint,
      defaultRadiusKm,
      priceMin,
      priceMax,
    } = req.body || {};
    const coll = await getPreferencesCollection();
    const update = {
      userId,
      bedrooms: bedrooms ?? DEFAULT_PREFERENCES.bedrooms,
      bathrooms: bathrooms ?? DEFAULT_PREFERENCES.bathrooms,
      parking: parking ?? DEFAULT_PREFERENCES.parking,
      suburbPreference: suburbPreference ?? DEFAULT_PREFERENCES.suburbPreference,
      referencePoint: referencePoint ?? suburbPreference ?? DEFAULT_PREFERENCES.referencePoint,
      defaultRadiusKm: defaultRadiusKm ?? DEFAULT_PREFERENCES.defaultRadiusKm,
      ...(priceMin != null && { priceMin: Number(priceMin) }),
      ...(priceMax != null && { priceMax: Number(priceMax) }),
      updatedAt: new Date(),
    };
    await coll.updateOne(
      { userId },
      { $set: update },
      { upsert: true }
    );
    res.json(update);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

preferencesRouter.get('/initial-properties', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'demo-buyer';
    const coll = await getPreferencesCollection();
    const doc = await coll.findOne({ userId });
    const prefs = doc
      ? {
          bedrooms: doc.bedrooms ?? DEFAULT_PREFERENCES.bedrooms,
          bathrooms: doc.bathrooms ?? DEFAULT_PREFERENCES.bathrooms,
          parking: doc.parking ?? DEFAULT_PREFERENCES.parking,
          suburbPreference: doc.suburbPreference ?? DEFAULT_PREFERENCES.suburbPreference,
          defaultRadiusKm: doc.defaultRadiusKm ?? DEFAULT_PREFERENCES.defaultRadiusKm,
        }
      : DEFAULT_PREFERENCES;
    const poi = await getPoiCoordinates(prefs.suburbPreference);
    const centre = poi
      ? { lng: poi.lng, lat: poi.lat, radiusKm: prefs.defaultRadiusKm }
      : { ...getDefaultCentre(), radiusKm: prefs.defaultRadiusKm };
    const { properties } = await runSearch(
      'apartment property',
      centre,
      { bedrooms: prefs.bedrooms, bathrooms: prefs.bathrooms, parking: prefs.parking }
    );
    let list = properties;
    if (doc?.priceMin != null || doc?.priceMax != null) {
      list = list.filter(
        (p) =>
          (doc.priceMin == null || p.price >= doc.priceMin) &&
          (doc.priceMax == null || p.price <= doc.priceMax)
      );
    }
    res.json({ properties: list.slice(0, 10) });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Server error', properties: [] });
  }
});
