import { type GetServerSideProps } from 'next';
import { SITE_URL } from '~/components/Site/constants';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.write(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  res.end();

  return { props: {} };
};

export default function RobotsTxt() {
  return null;
}
