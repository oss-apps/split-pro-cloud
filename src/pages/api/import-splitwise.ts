import { TRPCError } from '@trpc/server';
import { type NextApiRequest, type NextApiResponse } from 'next';

import { MAX_IMPORT_BODY_BYTES, importItemRequestSchema } from '~/lib/splitwiseImport';
import { importSplitwiseItem } from '~/server/api/services/splitwiseImport';
import { getServerAuthSession } from '~/server/auth';
import { type RateLimitRule, consumeRateLimit } from '~/server/rateLimit';

// The body is read only once the user is signed in.
export const config = {
  api: { bodyParser: false },
};

const IMPORT_LIMIT: RateLimitRule = {
  name: 'splitwise-import:user:1h',
  limit: 300,
  windowSeconds: 3600,
};

const readJson = async (req: NextApiRequest): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (MAX_IMPORT_BODY_BYTES < size) {
      return 'too_large';
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if ('POST' !== req.method) {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // A JSON body can't be sent by a plain cross-site form.
  if (!req.headers['content-type']?.startsWith('application/json')) {
    return res.status(415).json({ error: 'Expected JSON' });
  }

  const session = await getServerAuthSession({ req, res });
  if (!session?.user) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }

  const { allowed } = await consumeRateLimit(IMPORT_LIMIT, String(session.user.id));
  if (!allowed) {
    return res
      .status(429)
      .json({ error: 'Too many imports in a short time. Please wait a while and try again.' });
  }

  const body = await readJson(req);
  if ('too_large' === body) {
    return res.status(413).json({ error: 'This group is too large to import in one go.' });
  }

  const parsed = importItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: "This file doesn't look like a Splitwise export." });
  }

  try {
    return res.status(200).json(await importSplitwiseItem(session.user, parsed.data));
  } catch (error) {
    if (error instanceof TRPCError) {
      return res.status('CONFLICT' === error.code ? 409 : 400).json({ error: error.message });
    }
    console.error('Splitwise import failed', error);
    return res
      .status(500)
      .json({ error: 'Something went wrong while importing. Please try again.' });
  }
}
