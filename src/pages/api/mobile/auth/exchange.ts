import { z } from 'zod';

import { getClientIp } from '~/server/clientIp';
import { exchangeHandoffCode, mobileAuthRoute, parseInput } from '~/server/mobileAuth';

const bodySchema = z.object({ code: z.string().min(1).max(128), verifier: z.string().max(128) });

export default mobileAuthRoute('POST', async (req, res) => {
  const { code, verifier } = parseInput(bodySchema, req.body);

  res.status(200).json(await exchangeHandoffCode(code, verifier, getClientIp(req)));
});
