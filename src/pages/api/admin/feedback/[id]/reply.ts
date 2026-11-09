import { AdminApiError, adminApiRoute, queryParam } from '~/server/adminApi';
import {
  FeedbackNotFoundError,
  IdempotencyConflictError,
  replyBody,
  replyToFeedback,
} from '~/server/api/services/feedbackAdmin';
import { MailNotSentError } from '~/server/mailer';

/**
 * POST /api/admin/feedback/{id}/reply with `{ "message": string, "idempotencyKey": string }`
 * Emails the reply and records it: 201 when sent now, 200 when that key was already sent, 502 when
 * the email couldn't be sent (nothing is recorded then, so it's safe to retry).
 */
export default adminApiRoute(['POST'], async (req, res) => {
  const id = queryParam(req.query.id) ?? '';
  const body = replyBody.parse(req.body);

  try {
    const { reply, created } = await replyToFeedback(id, body);
    res.status(created ? 201 : 200).json({ reply, created });
  } catch (error) {
    if (error instanceof FeedbackNotFoundError) {
      throw new AdminApiError(404, error.message);
    }
    if (error instanceof IdempotencyConflictError) {
      throw new AdminApiError(409, error.message);
    }
    if (error instanceof MailNotSentError) {
      console.error('Feedback reply email not sent', id, error.message);
      throw new AdminApiError(502, `Email not sent: ${error.message}`);
    }
    throw error;
  }
});
