import { z } from 'zod';

import { getClientIp } from '~/server/clientIp';
import { mobileAuthRoute, parseInput, sendEmailCode } from '~/server/mobileAuth';

const bodySchema = z.object({ email: z.string().max(320) });

export default mobileAuthRoute('POST', async (req, res) => {
  const { email } = parseInput(bodySchema, req.body);

  await sendEmailCode(email, getClientIp(req));
  res.status(200).json({ ok: true });
});
