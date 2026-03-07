import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getPoiCoordinates, getDefaultCentre } from '../services/poi';
import { runSearch, type PropertySummary } from '../services/search';
import { getMarketEstimate } from '../services/market';

/**
 * Tool definitions for the agent. The prompt (graph.ts) instructs which tool to call per intent;
 * these descriptions and schemas are what the model uses to choose tools and fill args (tool-calling chain).
 */
const DEFAULT_PREFS = { bedrooms: 2, bathrooms: 2, parking: 1 };

// @ts-expect-error TS2589 - LangChain tool() has excessively deep type instantiation with Zod
export const getPoiCoordinatesTool = tool(
  async (input: { poi_name: string }) => {
    const loc = await getPoiCoordinates(input.poi_name);
    if (loc) return JSON.stringify({ lng: loc.lng, lat: loc.lat, name: loc.name });
    const def = getDefaultCentre();
    return JSON.stringify({ lng: def.lng, lat: def.lat, name: def.name, default: true });
  },
  {
    name: 'get_poi_coordinates',
    description: 'Get coordinates for a point of interest (e.g. school, station, shop) by name. Use when the user says "close to X" or "near X". Returns lng, lat. If not found, returns Carlingford town centre as default.',
    schema: z.object({
      poi_name: z.string().describe('Name of the POI, e.g. "James Ruse Public School", "Carlingford Station"'),
    }),
  }
);

// @ts-expect-error TS2589 - LangChain tool() has excessively deep type instantiation with Zod
export const propertySearchTool = tool(
  async (input: {
    query_text: string;
    place_name?: string;
    lng?: number;
    lat?: number;
    radius_km?: number;
    bedrooms?: number;
    bathrooms?: number;
    parking?: number;
  }) => {
    let centre: { lng: number; lat: number; radiusKm: number };
    if (input.lng != null && input.lat != null) {
      centre = { lng: input.lng, lat: input.lat, radiusKm: input.radius_km ?? 5 };
    } else if (input.place_name) {
      const loc = await getPoiCoordinates(input.place_name);
      centre = loc
        ? { ...loc, radiusKm: input.radius_km ?? 5 }
        : { ...getDefaultCentre(), radiusKm: input.radius_km ?? 5 };
    } else {
      centre = { ...getDefaultCentre(), radiusKm: input.radius_km ?? 5 };
    }
    const { properties, toolCallsLog, aggregationPipeline } = await runSearch(
      input.query_text,
      centre,
      {
        bedrooms: input.bedrooms ?? DEFAULT_PREFS.bedrooms,
        bathrooms: input.bathrooms ?? DEFAULT_PREFS.bathrooms,
        parking: input.parking ?? DEFAULT_PREFS.parking,
      }
    );
    return JSON.stringify({ properties, toolCallsLog, aggregationPipeline });
  },
  {
    name: 'property_search',
    description: 'Search properties by semantic query and location. Pipeline: geo filter + vector search (semantic + bedrooms/baths/parking filters) + rerank. Do NOT call this tool until the user has specified how many bedrooms (e.g. in their message or in a previous reply like "2 bedroom"). Use query_text for what they want (e.g. "renovated, natural light, quiet"); use place_name for where (suburb, station, or POI). When the user replies with only a number or "X bedroom(s)" (e.g. "2 bedroom"), use that as bedrooms and use the previous user message for query_text and place_name. Pass bedrooms so the vector search filters correctly.',
    schema: z.object({
      query_text: z.string().describe('Semantic search query describing what the buyer wants (e.g. renovated, natural light, quiet)'),
      place_name: z.string().optional().describe('Place to search near: suburb, station, or POI name (e.g. Carlingford, Epping Station, James Ruse Public School)'),
      lng: z.number().optional().describe('Longitude of centre (optional if place_name is set)'),
      lat: z.number().optional().describe('Latitude of centre (optional if place_name is set)'),
      radius_km: z.number().optional().describe('Radius in km (default 5)'),
      bedrooms: z.number().optional().describe('Number of bedrooms (required for filtering; ask user if not specified)'),
      bathrooms: z.number().optional().describe('Number of bathrooms'),
      parking: z.number().optional().describe('Number of parking spaces'),
    }),
  }
);

// @ts-expect-error TS2589 - LangChain tool() has excessively deep type instantiation with Zod
export const getMarketEstimateTool = tool(
  async (input: { suburb: string; beds: number; baths: number; parking: number }) => {
    const est = await getMarketEstimate(input.suburb, input.beds, input.baths, input.parking);
    if (!est) return JSON.stringify({ found: false, message: 'No market data for this criteria.' });
    return JSON.stringify({
      found: true,
      suburb: est.suburb,
      beds: est.beds,
      baths: est.baths,
      parking: est.parking,
      avgPrice: est.avgPrice,
      currency: est.currency,
      growthRatePct: est.growthRatePct,
      history: est.history,
    });
  },
  {
    name: 'get_market_estimate',
    description:
      'Get average price guide from market_data. Call only for price/market questions. Use the exact suburb name the user said (e.g. if they say "in Parramatta" use suburb "Parramatta"). Do not default to another suburb—use the one in the user\'s question. Beds: 2 for two bedroom, 3 for three bedroom. Baths/parking: 2 and 1 if unspecified.',
    schema: z.object({
      suburb: z.string().describe('The suburb the user asked about. Use the exact suburb name from the user\'s message (we have market data for various suburbs).'),
      beds: z.number().describe('Number of bedrooms (e.g. 2 for two bedroom, 3 for three bedroom)'),
      baths: z.number().describe('Number of bathrooms (default 2 if unspecified)'),
      parking: z.number().describe('Number of parking spaces (default 1 if unspecified)'),
    }),
  }
);

/** Only these two tools are exposed to the agent; POI resolution is done inside property_search via place_name. */
export const agentTools = [getMarketEstimateTool, propertySearchTool];
