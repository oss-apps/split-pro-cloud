import { AdminApiError, adminApiRoute, queryParam } from '~/server/adminApi';
import {
  FeedbackNotFoundError,
  setFeedbackStatus,
  statusBody,
} from '~/server/api/services/feedbackAdmin';

/**
 * PATCH /api/admin/feedback/{id} with `{ "status": "NEW" | "REPLIED" | "CLOSED" }`
 */
export default adminApiRoute(['PATCH'], async (req, res) => {
  const id = queryParam(req.query.id) ?? '';
  const { status } = statusBody.parse(req.body);

  try {
    res.status(200).json(await setFeedbackStatus(id, status));
  } catch (error) {
    if (error instanceof FeedbackNotFoundError) {
      throw new AdminApiError(404, error.message);
    }
    throw error;
  }
});
