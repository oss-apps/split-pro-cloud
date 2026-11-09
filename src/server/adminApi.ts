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

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

type Handler = (req: NextApiRequest, res: NextApiResponse, body: unknown) => Promise<unknown>;

/**
 * Reads and parses a JSON body of at most `maxBytes`.
 */
const readJsonBody = async (req: NextApiRequest, maxBytes: number): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > maxBytes) {
      throw new AdminApiError(413, 'Body too large');
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if ('' === text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdminApiError(400, 'Invalid JSON');
  }
};

/**
 * Only an error's name and Prisma or Node code: messages can contain request data.
 */
const safeErrorDetails = (error: unknown) => {
  if (!(error instanceof Error)) {
    return { name: typeof error };
  }
  const { code } = error as { code?: unknown };
  return { name: error.name, code: 'string' === typeof code ? code : undefined };
};

/**
 * An internal admin API route: answers 404 unless ADMIN_API_TOKEN is set, then needs
 * `Authorization: Bearer <ADMIN_API_TOKEN>`. Only `methods` are allowed, bodies must be JSON (read
 * only once the request is authorised, so the route needs `bodyParser: false` in its config) and every response is
 * JSON. `AdminApiError` and zod errors become their status codes.
 */
export const adminApiRoute =
  (methods: string[], handler: Handler, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) =>
  async (req: NextApiRequest, res: NextApiResponse) => {
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

    const hasBody = 'GET' !== req.method;
    if (hasBody && !isJsonContentType(req.headers['content-type'])) {
      return res.status(415).json({ error: 'Send a JSON body' });
    }

    try {
      const body = hasBody ? await readJsonBody(req, maxBodyBytes) : undefined;
      await handler(req, res, body);
    } catch (error) {
      if (error instanceof AdminApiError) {
        return res.status(error.status).json({ error: error.message });
      }
      if (error instanceof ZodError) {
        return res.status(400).json({ error: 'Invalid request', issues: error.issues });
      }
      console.error('Admin API error', safeErrorDetails(error));
      return res.status(500).json({ error: 'Internal server error' });
    }
  };

/** A single string route or query param. */
export const queryParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
