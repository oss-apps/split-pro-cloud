import { type NextApiRequest } from 'next';

/**
 * splitpro.app sits behind Cloudflare, which sets cf-connecting-ip; fall back to the proxy chain.
 */
export const getClientIp = (req: NextApiRequest): string => {
  const ip = [req.headers['cf-connecting-ip'], req.headers['x-forwarded-for']]
    .map((header) => (Array.isArray(header) ? header[0] : header))
    .map((value) => value?.split(',')[0]?.trim())
    .find((value) => value);

  return ip ?? req.socket.remoteAddress ?? 'unknown';
};
