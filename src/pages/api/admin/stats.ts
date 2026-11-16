import { adminApiRoute } from '~/server/adminApi';
import { adminStatsQuery, getAdminStats } from '~/server/api/services/adminStats';
import { db } from '~/server/db';

// Read by `adminApiRoute`, once the request is authorised
export const config = { api: { bodyParser: false } };

/**
 * GET /api/admin/stats?days=<1-365, default 90>
 * Read-only growth numbers: totals, daily counts for the last `days` UTC days, and distinct active
 * users for the last 12 ISO weeks and 6 months. See `adminStats.ts` for what each number means.
 */
export default adminApiRoute(['GET'], async (req, res) => {
  const { days } = adminStatsQuery.parse(req.query);
  res.status(200).json(await getAdminStats(db, { days }));
});
