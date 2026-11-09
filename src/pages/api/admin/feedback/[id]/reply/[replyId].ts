import { AdminApiError, adminApiRoute, queryParam } from '~/server/adminApi';
import {
  ReplyNotFoundError,
  ReplyNotSendingError,
  resolveReply,
  resolveReplyBody,
} from '~/server/api/services/feedbackAdmin';

// Read by `adminApiRoute`, once the request is authorised
export const config = { api: { bodyParser: false } };

/**
 * PATCH /api/admin/feedback/{id}/reply/{replyId} with `{ "deliveryStatus": "SENT" | "FAILED" }`
 * Settles a reply stuck in SENDING once you've checked whether it was delivered. SENT records it
 * as sent; FAILED lets the same key and message be sent again. 409 unless it's SENDING.
 */
export default adminApiRoute(['PATCH'], async (req, res, body) => {
  const feedbackId = queryParam(req.query.id) ?? '';
  const replyId = queryParam(req.query.replyId) ?? '';
  const input = resolveReplyBody.parse(body);

  try {
    res.status(200).json({ reply: await resolveReply(feedbackId, replyId, input) });
  } catch (error) {
    if (error instanceof ReplyNotFoundError) {
      throw new AdminApiError(404, error.message);
    }
    if (error instanceof ReplyNotSendingError) {
      throw new AdminApiError(409, error.message);
    }
    throw error;
  }
});
