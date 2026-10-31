import { z } from 'zod';

import { getClientIp } from '~/server/clientIp';
import { mobileAuthRoute, parseInput, signInWithApple } from '~/server/mobileAuth';

const namePart = z.string().max(100).nullish();

const bodySchema = z.object({
  identityToken: z.string().min(1).max(8192),
  // expo-apple-authentication's AppleAuthenticationFullName, or an already formatted name
  fullName: z
    .union([
      z.string().max(300),
      z.object({ givenName: namePart, middleName: namePart, familyName: namePart }),
    ])
    .nullish(),
});

export default mobileAuthRoute('POST', async (req, res) => {
  const { identityToken, fullName } = parseInput(bodySchema, req.body);

  res.status(200).json(await signInWithApple(identityToken, fullName, getClientIp(req)));
});
