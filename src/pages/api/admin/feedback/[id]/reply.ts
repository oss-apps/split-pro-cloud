import { AdminApiError, adminApiRoute, queryParam } from '~/server/adminApi';
import {
  FeedbackNotFoundError,
  IdempotencyConflictError,
  ReplyInProgressError,
  replyBody,
  replyToFeedback,
} from '~/server/api/services/feedbackAdmin';
import { MailNotSentError } from '~/server/mailer';

// Read by `adminApiRoute`, once the request is authorised
export const config = { api: { bodyParser: false } };

/**
 * POST /api/admin/feedback/{id}/reply with `{ "message": string, "idempotencyKey": string }`
 * Emails the reply and records it. 201 when sent now, 200 when that key was already sent, 409 when
 * it's being sent or it's unknown whether it went, 502 when the email wasn't sent (retry with the
 * same key) or it's unknown whether it went (not retried).
 */
export default adminApiRoute(['POST'], async (req, res, body) => {
  const id = queryParam(req.query.id) ?? '';
  const input = replyBody.parse(body);

  try {
    const { reply, created } = await replyToFeedback(id, input);
    res.status(created ? 201 : 200).json({ reply, created });
  } catch (error) {
    if (error instanceof FeedbackNotFoundError) {
      throw new AdminApiError(404, error.message);
    }
    if (error instanceof IdempotencyConflictError || error instanceof ReplyInProgressError) {
      throw new AdminApiError(409, error.message);
    }
    if (error instanceof MailNotSentError) {
      // Only codes: the error message can contain the recipient or the server's reply
      console.error('Feedback reply email not sent', {
        feedbackId: id,
        code: error.code,
        responseCode: error.responseCode,
        definite: error.definite,
      });
      throw new AdminApiError(
        502,
        error.definite ? 'Email not sent' : 'Email delivery uncertain; not resending',
      );
    }
    throw error;
  }
});
