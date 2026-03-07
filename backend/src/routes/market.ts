import { Router } from 'express';
import { getMarketEstimate } from '../services/market';

export const marketRouter = Router();

/**
 * GET /api/market-estimate?suburb=Carlingford&beds=2&baths=2&parking=1
 * Debug: verify market_data lookup. Returns the same shape the agent tool returns.
 */
marketRouter.get('/market-estimate', async (req, res) => {
  try {
    const suburb = typeof req.query.suburb === 'string' ? req.query.suburb.trim() : '';
    const beds = req.query.beds != null ? Number(req.query.beds) : NaN;
    const baths = req.query.baths != null ? Number(req.query.baths) : NaN;
    const parking = req.query.parking != null ? Number(req.query.parking) : NaN;
    if (!suburb || Number.isNaN(beds) || Number.isNaN(baths) || Number.isNaN(parking)) {
      return res.status(400).json({
        error: 'Query params required: suburb, beds, baths, parking',
        example: '/api/market-estimate?suburb=Carlingford&beds=2&baths=2&parking=1',
      });
    }
    const est = await getMarketEstimate(suburb, beds, baths, parking);
    if (!est) {
      return res.json({ found: false, message: 'No market data for this criteria.' });
    }
    res.json({
      found: true,
      suburb: est.suburb,
      avgPrice: est.avgPrice,
      currency: est.currency,
      growthRatePct: est.growthRatePct,
      history: est.history,
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});
