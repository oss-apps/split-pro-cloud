import { z } from 'zod';

import { env } from '~/env';
import {
  MobileAuthError,
  mobileAuthRoute,
  parseHandoffParams,
  parseInput,
  rememberChallenge,
  signOutBrowserSession,
} from '~/server/mobileAuth';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

/**
 * next-auth only starts OAuth from a POST with a CSRF token, so this page fetches one and submits
 * the same form the web sign-in button would. next-auth passes the action's query on to the
 * provider, so Google always asks which account to use.
 */
const renderSignInPage = (provider: string, callbackUrl: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Signing in to SplitPro</title>
  </head>
  <body style="font-family: system-ui, sans-serif; text-align: center; padding-top: 30vh">
    <p id="status">Signing in to SplitPro…</p>
    <form method="post" action="/api/auth/signin/${provider}?prompt=select_account">
      <input type="hidden" name="csrfToken" />
      <input type="hidden" name="callbackUrl" value="${escapeHtml(callbackUrl)}" />
    </form>
    <script>
      fetch('/api/auth/csrf', { credentials: 'same-origin' })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          var form = document.forms[0];
          form.csrfToken.value = data.csrfToken;
          form.submit();
        })
        .catch(function () {
          document.getElementById('status').textContent =
            'Could not start sign in. Close this window and try again.';
        });
    </script>
  </body>
</html>`;

const querySchema = z.object({ provider: z.literal('google') });

export default mobileAuthRoute('GET', async (req, res) => {
  const { provider } = parseInput(querySchema, req.query);
  const { challenge, redirect } = parseHandoffParams(req.query);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new MobileAuthError(503, 'Google sign-in is not configured');
  }

  const callbackUrl = `/api/mobile/auth/handoff?${new URLSearchParams({ challenge, redirect }).toString()}`;

  await signOutBrowserSession(req, res);
  rememberChallenge(res, challenge);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderSignInPage(provider, callbackUrl));
});
