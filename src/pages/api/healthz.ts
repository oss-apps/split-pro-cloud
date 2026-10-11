import { type NextApiRequest, type NextApiResponse } from 'next';

import { db } from '~/server/db';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    await db.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}
