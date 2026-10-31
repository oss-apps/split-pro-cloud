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
import { isOwnNavigation } from '~/server/mobileAuthTokens';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

const renderPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; text-align: center; padding-top: 30vh">
${body}
  </body>
</html>`;

/**
 * next-auth only starts OAuth from a POST with a CSRF token, so this page fetches one and submits
 * the same form the web sign-in button would. next-auth passes the action's query on to the
 * provider, so Google always asks which account to use.
 */
const renderSignInPage = (provider: string, callbackUrl: string) =>
  renderPage(
    'Signing in to SplitPro',
    `    <p id="status">Signing in to SplitPro…</p>
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
    </script>`,
  );

const START_FROM_APP_PAGE = renderPage(
  'Sign in from the SplitPro app',
  '    <p>To sign in to the SplitPro app, open the app and start signing in there.</p>',
);

const querySchema = z.object({ provider: z.literal('google') });

export default mobileAuthRoute('GET', async (req, res) => {
  const { provider } = parseInput(querySchema, req.query);
  const { challenge, redirect } = parseHandoffParams(req.query);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new MobileAuthError(503, 'Google sign-in is not configured');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // The app opens this in a browser of its own. A link from another site must not be able to sign
  // the visitor out of the web, which is the first thing this does.
  if (!isOwnNavigation(req.headers['sec-fetch-site'], req.headers.referer, env.NEXTAUTH_URL)) {
    res.status(403).send(START_FROM_APP_PAGE);
    return;
  }

  const callbackUrl = `/api/mobile/auth/handoff?${new URLSearchParams({ challenge, redirect }).toString()}`;

  await signOutBrowserSession(req, res);
  rememberChallenge(res, challenge);
  res.status(200).send(renderSignInPage(provider, callbackUrl));
});
