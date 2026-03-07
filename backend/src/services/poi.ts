import { getPoisCollection } from '../db/collections';

const CARLINGFORD_CENTRE = { lng: 151.0485, lat: -33.7819 };

export interface PoiLocation {
  lng: number;
  lat: number;
  name?: string;
}

/**
 * Get coordinates for a POI by name (partial match). Returns null if not found.
 */
export async function getPoiCoordinates(poiName: string): Promise<PoiLocation | null> {
  const coll = await getPoisCollection();
  const nameRegex = new RegExp(poiName.replace(/\s+/g, ' ').trim(), 'i');
  const doc = await coll.findOne({ name: nameRegex });
  if (!doc || !doc.location?.coordinates) return null;
  const [lng, lat] = doc.location.coordinates;
  return { lng, lat, name: doc.name };
}

export function getDefaultCentre(): PoiLocation {
  return { ...CARLINGFORD_CENTRE, name: 'Carlingford town centre' };
}
