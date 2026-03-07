import { getPropertiesCollection } from '../db/collections';
import { embedQuery, rerank } from './voyage';

/** Atlas Search index name (Lexical Prefilters: vector + geo + number). */
const SEARCH_INDEX_NAME = 'property_search';
const NUM_CANDIDATES = 200;
const VECTOR_LIMIT = 50;
const RERANK_TOP_DEFAULT = 10;

const DEFAULT_RADIUS_KM = 5;
const KM_TO_METERS = 1000;
/** Default pivot (meters) for Atlas Search near – distance at which score halves. */
const DEFAULT_PIVOT_METERS = 3000;

export interface GeoFilter {
  lng: number;
  lat: number;
  radiusKm?: number;
}

export interface StructuredFilter {
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  propertyType?: string;
  /** Suburb name for exact filter (e.g. from location autocomplete). */
  suburb?: string;
  priceMin?: number;
  priceMax?: number;
}

export interface PropertySummary {
  _id: string;
  title: string;
  description: string;
  suburb: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  propertyType: string;
  location?: { type: string; coordinates: number[] };
}

export interface SearchResult {
  properties: PropertySummary[];
  toolCallsLog: string[];
  /** JSON-serializable pipeline for display (e.g. in UI). */
  aggregationPipeline?: object[];
}

const FILTER_SEARCH_LIMIT = 200;

/**
 * Filter-only search for the Search button: match by beds, baths, parking, location (suburb), price.
 * No Atlas Search, no vector, no rerank—plain MongoDB $match.
 * Returns properties and a JSON-serializable aggregation pipeline for display.
 */
export async function runFilterSearch(params: {
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  suburb?: string;
  priceMin?: number;
  priceMax?: number;
}): Promise<{ properties: PropertySummary[]; aggregationPipeline: object[] }> {
  const props = await getPropertiesCollection();
  const match: Record<string, unknown> = {};
  const matchForDisplay: Record<string, unknown> = {};
  if (params.bedrooms != null) {
    match.bedrooms = params.bedrooms;
    matchForDisplay.bedrooms = params.bedrooms;
  }
  if (params.bathrooms != null) {
    match.bathrooms = { $gte: params.bathrooms };
    matchForDisplay.bathrooms = { $gte: params.bathrooms };
  }
  if (params.parking != null) {
    match.parking = { $gte: params.parking };
    matchForDisplay.parking = { $gte: params.parking };
  }
  if (params.suburb != null && params.suburb.trim()) {
    const suburbVal = params.suburb.trim();
    match.suburb = suburbVal;
    matchForDisplay.suburb = suburbVal;
  }
  if (params.priceMin != null || params.priceMax != null) {
    const priceCond: Record<string, number> = {};
    if (params.priceMin != null) priceCond.$gte = params.priceMin;
    if (params.priceMax != null) priceCond.$lte = params.priceMax;
    match.price = priceCond;
    matchForDisplay.price = priceCond;
  }
  const pipeline = [
    { $match: Object.keys(match).length ? match : {} },
    { $limit: FILTER_SEARCH_LIMIT },
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        suburb: 1,
        price: 1,
        bedrooms: 1,
        bathrooms: 1,
        parking: 1,
        propertyType: 1,
        location: 1,
      },
    },
  ];
  const aggregationPipelineForDisplay = [
    { $match: Object.keys(matchForDisplay).length ? matchForDisplay : {} },
    { $limit: FILTER_SEARCH_LIMIT },
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        suburb: 1,
        price: 1,
        bedrooms: 1,
        bathrooms: 1,
        parking: 1,
        propertyType: 1,
        location: 1,
      },
    },
  ];
  const cursor = props.aggregate(pipeline);
  const docs = await cursor.toArray();
  const properties: PropertySummary[] = docs.map((d: any) => {
    const loc = d.location;
    const location =
      loc?.coordinates &&
      Array.isArray(loc.coordinates) &&
      loc.coordinates.length >= 2 &&
      typeof loc.coordinates[0] === 'number' &&
      typeof loc.coordinates[1] === 'number'
        ? { type: loc.type || 'Point', coordinates: [loc.coordinates[0], loc.coordinates[1]] as [number, number] }
        : undefined;
    return {
      _id: (d._id && typeof d._id.toString === 'function' ? d._id : String(d._id)).toString(),
      title: d.title ?? '',
      description: d.description ?? '',
      suburb: d.suburb ?? '',
      price: d.price ?? 0,
      bedrooms: d.bedrooms ?? 0,
      bathrooms: d.bathrooms ?? 0,
      parking: d.parking ?? 0,
      propertyType: d.propertyType ?? '',
      location,
    };
  });
  return { properties, aggregationPipeline: aggregationPipelineForDisplay };
}

/**
 * Run vector search with geo + structured filter, then rerank.
 * @param resultLimit - number of properties to return (default 10); use higher (e.g. 30) for filter search.
 */
export async function runSearch(
  queryText: string,
  geo: GeoFilter,
  structured: StructuredFilter,
  resultLimit: number = RERANK_TOP_DEFAULT
): Promise<SearchResult> {
  const toolCallsLog: string[] = [];
  const props = await getPropertiesCollection();

  const { lng, lat, radiusKm = DEFAULT_RADIUS_KM } = geo;
  const pivotMeters = Math.round(radiusKm * KM_TO_METERS) || DEFAULT_PIVOT_METERS;

  const filterClauses: object[] = [];
  if (lng != null && lat != null) {
    filterClauses.push({
      near: {
        path: 'location',
        origin: { type: 'Point', coordinates: [lng, lat] },
        pivot: pivotMeters,
      },
    });
  }
  if (structured.bedrooms != null) {
    filterClauses.push({ equals: { path: 'bedrooms', value: structured.bedrooms } });
  }
  if (structured.bathrooms != null) {
    filterClauses.push({ range: { path: 'bathrooms', gte: structured.bathrooms } });
  }
  if (structured.parking != null) {
    filterClauses.push({ range: { path: 'parking', gte: structured.parking } });
  }
  if (filterClauses.length === 0) {
    filterClauses.push({ exists: { path: '_id' } });
  }

  toolCallsLog.push('geo_search');
  toolCallsLog.push('vector_search');

  const queryVector = await embedQuery(queryText);

  const searchStage: Record<string, unknown> = {
    $search: {
      index: SEARCH_INDEX_NAME,
      vectorSearch: {
        path: 'embedding',
        queryVector,
        numCandidates: NUM_CANDIDATES,
        limit: VECTOR_LIMIT,
        filter: { compound: { filter: filterClauses } },
      },
    },
  };

  const pipeline = [
    searchStage,
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        suburb: 1,
        price: 1,
        bedrooms: 1,
        bathrooms: 1,
        parking: 1,
        propertyType: 1,
        location: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ];

  const aggregationPipelineForDisplay: object[] = [
    {
      $search: {
        index: SEARCH_INDEX_NAME,
        vectorSearch: {
          path: 'embedding',
          queryVector: '<query vector (1024 dims)>',
          numCandidates: NUM_CANDIDATES,
          limit: VECTOR_LIMIT,
          filter: { compound: { filter: filterClauses } },
        },
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        suburb: 1,
        price: 1,
        bedrooms: 1,
        bathrooms: 1,
        parking: 1,
        propertyType: 1,
        location: 1,
        score: { $meta: 'searchScore' },
      },
    },
  ];

  const cursor = props.aggregate(pipeline);
  const candidates: any[] = await cursor.toArray();

  if (candidates.length === 0) {
    return { properties: [], toolCallsLog, aggregationPipeline: aggregationPipelineForDisplay };
  }

  toolCallsLog.push('reranker');

  const docTexts = candidates.map(
    (d) =>
      `${d.title ?? ''}. ${d.bedrooms ?? 0} bed, ${d.bathrooms ?? 0} bath, ${d.parking ?? 0} parking. ${d.suburb ?? ''}. ${d.description ?? ''}`.trim()
  );
  const rerankTop = Math.min(resultLimit, candidates.length);
  const reranked = await rerank(queryText, docTexts, rerankTop);

  const topIds = reranked.map((r) => candidates[r.index]._id.toString());
  const orderMap = new Map(topIds.map((id, i) => [id, i]));
  const ordered = [...candidates]
    .filter((c) => orderMap.has(c._id.toString()))
    .sort((a, b) => (orderMap.get(a._id.toString()) ?? 99) - (orderMap.get(b._id.toString()) ?? 99));

  const properties: PropertySummary[] = ordered.slice(0, resultLimit).map((d) => ({
    _id: d._id.toString(),
    title: d.title,
    description: d.description,
    suburb: d.suburb,
    price: d.price,
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    parking: d.parking,
    propertyType: d.propertyType,
    location: d.location,
  }));

  return { properties, toolCallsLog, aggregationPipeline: aggregationPipelineForDisplay };
}
