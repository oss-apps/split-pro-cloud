import { type GetServerSideProps } from 'next';
import { env } from '~/env';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  if (!env.ADSENSE_CLIENT) {
    return { notFound: true };
  }

  const publisherId = env.ADSENSE_CLIENT.replace('ca-', '');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.write(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`);
  res.end();

  return { props: {} };
};

export default function AdsTxt() {
  return null;
}
