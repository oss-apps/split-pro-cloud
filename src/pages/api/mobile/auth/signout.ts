import { z } from 'zod';

import {
  MobileAuthError,
  deleteMobileSession,
  mobileAuthRoute,
  parseInput,
} from '~/server/mobileAuth';
import { getBearerToken } from '~/server/mobileAuthTokens';

// The device's push token, so it stops getting notifications even if unregistering it failed
const bodySchema = z.object({ pushToken: z.string().max(255).optional() });

export default mobileAuthRoute('POST', async (req, res) => {
  const token = getBearerToken(req.headers.authorization);

  if (!token) {
    throw new MobileAuthError(401, 'Missing bearer token');
  }

  const { pushToken } = parseInput(bodySchema, req.body ?? {});

  await deleteMobileSession(token, pushToken);
  res.status(200).json({ ok: true });
});
