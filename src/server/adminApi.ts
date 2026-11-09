import { type NextApiRequest, type NextApiResponse } from 'next';
import { ZodError } from 'zod';

import { env } from '~/env';
import { isAdminAuthorized } from '~/server/adminAuth';
import { isJsonContentType } from '~/server/mobileAuthTokens';

export class AdminApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

/**
 * An internal admin API route: answers 404 unless ADMIN_API_TOKEN is set, then needs
 * `Authorization: Bearer <ADMIN_API_TOKEN>`. Only `methods` are allowed, bodies must be JSON and
 * every response is JSON. `AdminApiError` and zod errors become their status codes.
 */
export const adminApiRoute =
  (methods: string[], handler: Handler) => async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!env.ADMIN_API_TOKEN) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!isAdminAuthorized(req.headers.authorization, env.ADMIN_API_TOKEN)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.method || !methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if ('GET' !== req.method && !isJsonContentType(req.headers['content-type'])) {
      return res.status(415).json({ error: 'Send a JSON body' });
    }

    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof AdminApiError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error instanceof ZodError) {
        return res.status(400).json({ error: 'Invalid request', issues: error.issues });
      }
      console.error('Admin API error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };

/** A single string route or query param. */
export const queryParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
