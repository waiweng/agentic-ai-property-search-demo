import { Router } from 'express';
import { runFilterSearch } from '../services/search';

export const searchRouter = Router();

/**
 * POST /api/search – Filter-only search for the Search button.
 * Matches properties by beds, baths, parking, location (suburb), and price min/max.
 * No vector search or reranking.
 */
searchRouter.post('/', async (req, res) => {
  try {
    const {
      bedrooms = 2,
      bathrooms = 2,
      parking = 1,
      location = 'Carlingford',
      priceMin,
      priceMax,
    } = req.body || {};
    const locationStr = String(location).trim();
    const minPrice = priceMin != null ? Number(priceMin) : undefined;
    const maxPrice = priceMax != null ? Number(priceMax) : undefined;
    const { properties, aggregationPipeline } = await runFilterSearch({
      bedrooms: Number(bedrooms),
      bathrooms: Number(bathrooms),
      parking: Number(parking),
      suburb: locationStr || undefined,
      priceMin: minPrice,
      priceMax: maxPrice,
    });
    const priceStep =
      minPrice != null && maxPrice != null
        ? 'min $' + minPrice + ', max $' + maxPrice
        : minPrice != null
          ? 'min $' + minPrice
          : maxPrice != null
            ? 'max $' + maxPrice
            : 'any';
    const pipelineSteps = [
      'Filter by beds ≥ ' + bedrooms + ', baths ≥ ' + bathrooms + ', parking ≥ ' + parking,
      'Location: suburb "' + (locationStr || 'any') + '"',
      'Price: ' + priceStep,
    ];
    res.json({
      properties,
      toolCallsLog: ['filter_search'],
      pipelineSteps,
      aggregationPipeline,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Server error', properties: [], pipelineSteps: [], aggregationPipeline: [] });
  }
});
