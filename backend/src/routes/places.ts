import { Router } from 'express';
import { getPropertiesCollection } from '../db/collections';

/** Atlas Search index name: create in Atlas UI with autocomplete (Lucene) on field "suburb". */
const PROPERTY_SUBURB_AUTOCOMPLETE_INDEX = 'property_suburb_autocomplete';
const SUGGESTION_LIMIT = 15;

export const placesRouter = Router();

/**
 * GET /api/places/autocomplete?q=Car
 * Returns location (suburb) suggestions using Atlas Search autocomplete (Lucene) on the
 * suburb field. Requires an Atlas Search index named property_suburb_autocomplete in Atlas UI.
 * No regex fallback—ensures autocomplete hits Atlas Search for testing.
 */
placesRouter.get('/autocomplete', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ suggestions: [] });
    }
    const props = await getPropertiesCollection();
    const pipeline: object[] = [
      {
        $search: {
          index: PROPERTY_SUBURB_AUTOCOMPLETE_INDEX,
          autocomplete: {
            query: q,
            path: 'suburb',
          },
        },
      },
      { $limit: 100 },
      { $group: { _id: '$suburb' } },
      { $sort: { _id: 1 } },
      { $limit: SUGGESTION_LIMIT },
      { $project: { name: '$_id', _id: 0 } },
    ];
    const cursor = props.aggregate<{ name: string }>(pipeline);
    const suggestions = await cursor.toArray();
    res.json({ suggestions });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({
      error: e?.message || 'Server error',
      suggestions: [],
      hint: 'Ensure Atlas Search index "property_suburb_autocomplete" exists on the properties collection with autocomplete on suburb.',
    });
  }
});
