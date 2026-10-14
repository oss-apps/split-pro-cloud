import { type NextApiRequest, type NextApiResponse } from 'next';

import { env } from '~/env';
import { getClientIp } from '~/server/clientIp';

/**
 * Umami's collect endpoint, reached through the /stats/api/send rewrite. The hop happens on the
 * server, so Umami would otherwise attribute every hit to this app's address and fold all
 * visitors into one session; CLIENT_IP_HEADER on the Umami service points at the header below.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if ('POST' !== req.method) {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  // The tracker replays this token so Umami can skip re-resolving the session.
  const cache = req.headers['x-umami-cache'];

  try {
    const upstream = await fetch(`${env.UMAMI_UPSTREAM_URL}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Umami reads device, browser and OS off the user agent, and screens out bots with it.
        'User-Agent': req.headers['user-agent'] ?? '',
        'x-splitpro-client-ip': getClientIp(req),
        ...('string' === typeof cache && '' !== cache ? { 'x-umami-cache': cache } : {}),
      },
      body: JSON.stringify(req.body),
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).send(await upstream.text());
  } catch (error) {
    console.error('Failed to forward a page view to Umami', error);
    return res.status(502).end();
  }
}
