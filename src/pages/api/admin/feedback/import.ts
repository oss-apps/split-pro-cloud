import { adminApiRoute } from '~/server/adminApi';
import { importBody, importFeedback } from '~/server/api/services/feedbackAdmin';

// Read by `adminApiRoute`, once the request is authorised
export const config = { api: { bodyParser: false } };

/**
 * POST /api/admin/feedback/import with `{ "items": [...] }`, at most 500 items.
 * Only feedback from existing accounts is stored; the rest is counted as `unmatched`. Safe to run
 * again: items already imported (by `externalId`) are skipped.
 */
export default adminApiRoute(
  ['POST'],
  async (_req, res, body) => {
    const input = importBody.parse(body);
    res.status(200).json(await importFeedback(input));
  },
  // A full batch of long messages is past the default 1mb
  { maxBodyBytes: 10 * 1024 * 1024 },
);
