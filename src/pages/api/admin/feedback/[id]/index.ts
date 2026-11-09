import { AdminApiError, adminApiRoute, queryParam } from '~/server/adminApi';
import {
  FeedbackNotFoundError,
  setFeedbackStatus,
  statusBody,
} from '~/server/api/services/feedbackAdmin';

// Read by `adminApiRoute`, once the request is authorised
export const config = { api: { bodyParser: false } };

/**
 * PATCH /api/admin/feedback/{id} with `{ "status": "NEW" | "REPLIED" | "CLOSED" }`
 */
export default adminApiRoute(['PATCH'], async (req, res, body) => {
  const id = queryParam(req.query.id) ?? '';
  const { status } = statusBody.parse(body);

  try {
    res.status(200).json(await setFeedbackStatus(id, status));
  } catch (error) {
    if (error instanceof FeedbackNotFoundError) {
      throw new AdminApiError(404, error.message);
    }
    throw error;
  }
});
