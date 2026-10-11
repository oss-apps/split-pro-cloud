import { type NextApiRequest, type NextApiResponse } from 'next';

import { db } from '~/server/db';
import { RECURRING_RUNNER_LAST_TICK_KEY } from '~/server/api/services/recurringRunner';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    // Also checks the database. A runner that hasn't ticked lately doesn't make the app unhealthy.
    const lastTick = await db.appMetadata.findUnique({
      where: { key: RECURRING_RUNNER_LAST_TICK_KEY },
    });
    res.status(200).json({ ok: true, recurringRunnerLastTickAt: lastTick?.value ?? null });
  } catch {
    res.status(503).json({ ok: false });
  }
}
