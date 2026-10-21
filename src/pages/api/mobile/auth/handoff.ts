import {
  consumeRememberedChallenge,
  createHandoffCode,
  getHandoffSessionUserId,
  mobileAuthRoute,
  parseHandoffParams,
} from '~/server/mobileAuth';
import { appendQueryParams } from '~/server/mobileAuthTokens';

/**
 * Where the browser lands after signing in for the app: hands the app a one-time code.
 */
export default mobileAuthRoute('GET', async (req, res) => {
  const { challenge, redirectUrl } = parseHandoffParams(req.query);
  const remembered = consumeRememberedChallenge(req, res);

  if (challenge !== remembered?.challenge) {
    res.redirect(302, appendQueryParams(redirectUrl, { error: 'invalid_state' }));
    return;
  }

  // Only a session from the sign-in this /start began, never one the browser already had
  const userId = await getHandoffSessionUserId(req, remembered.issuedAt);

  if (null === userId) {
    res.redirect(302, appendQueryParams(redirectUrl, { error: 'unauthenticated' }));
    return;
  }

  const code = await createHandoffCode(challenge, userId);
  res.redirect(302, appendQueryParams(redirectUrl, { code }));
});
