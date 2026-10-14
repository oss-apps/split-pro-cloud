import { type NextApiRequest, type NextApiResponse } from 'next';

import { env } from '~/env';

/**
 * Umami's tracker, served from our own origin via the /stats/script.js rewrite. Loaded from the
 * analytics host directly it is a third-party script, which a large share of visitors block
 * before the request ever leaves the browser.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if ('GET' !== req.method && 'HEAD' !== req.method) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  try {
    const upstream = await fetch(`${env.UMAMI_UPSTREAM_URL}/script.js`);

    if (!upstream.ok) {
      console.error('Umami script upstream responded', upstream.status);
      return res.status(502).end();
    }

    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(await upstream.text());
  } catch (error) {
    console.error('Failed to fetch the Umami script', error);
    return res.status(502).end();
  }
}
