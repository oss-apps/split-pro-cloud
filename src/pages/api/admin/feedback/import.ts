import { adminApiRoute } from '~/server/adminApi';
import { importBody, importFeedback } from '~/server/api/services/feedbackAdmin';

// A full batch of long messages can be past Next's default 1mb.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

/**
 * POST /api/admin/feedback/import with `{ "items": [...] }`, at most 500 items.
 * Safe to run again: items already imported (by `externalId`) are skipped.
 */
export default adminApiRoute(['POST'], async (req, res) => {
  const body = importBody.parse(req.body);
  res.status(200).json(await importFeedback(body));
});
