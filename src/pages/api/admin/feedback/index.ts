import { adminApiRoute } from '~/server/adminApi';
import { listFeedback, listFeedbackQuery } from '~/server/api/services/feedbackAdmin';

// Read by `adminApiRoute`, once the request is authorised
export const config = { api: { bodyParser: false } };

/**
 * GET /api/admin/feedback?since=<iso>&status=<OPEN|REPLIED|CLOSED>&limit=<1-200>&cursor=<id>
 * Feedback newest first, with `nextCursor` for the next page.
 */
export default adminApiRoute(['GET'], async (req, res) => {
  const query = listFeedbackQuery.parse(req.query);
  res.status(200).json(await listFeedback(query));
});
