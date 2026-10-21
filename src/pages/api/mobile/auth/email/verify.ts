import { z } from 'zod';

import { getClientIp } from '~/server/clientIp';
import { mobileAuthRoute, parseInput, verifyEmailCode } from '~/server/mobileAuth';

const bodySchema = z.object({ email: z.string().max(320), code: z.string().min(1).max(64) });

export default mobileAuthRoute('POST', async (req, res) => {
  const { email, code } = parseInput(bodySchema, req.body);

  res.status(200).json(await verifyEmailCode(email, code, getClientIp(req)));
});
