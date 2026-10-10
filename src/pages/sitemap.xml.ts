import { type GetServerSideProps } from 'next';
import { SITE_URL, TOOLS } from '~/components/Site/constants';
import { getAllPosts } from '~/lib/blog';

const STATIC_PAGES = [
  { path: '/', priority: '1.0' },
  { path: '/tools', priority: '0.9' },
  ...TOOLS.map((tool) => ({ path: tool.href, priority: '0.9' })),
  { path: '/blog', priority: '0.8' },
  { path: '/privacy', priority: '0.3' },
  { path: '/terms', priority: '0.3' },
] as const;

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const urls = [
    ...STATIC_PAGES.map((page) => ({ loc: `${SITE_URL}${page.path}`, priority: page.priority })),
    ...getAllPosts().map((post) => ({
      loc: `${SITE_URL}/blog/${post.slug}`,
      priority: '0.7',
      lastmod: post.updated ?? post.date,
    })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (url) =>
        `  <url><loc>${url.loc}</loc>${'lastmod' in url ? `<lastmod>${url.lastmod}</lastmod>` : ''}<priority>${url.priority}</priority></url>`,
    ),
    '</urlset>',
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.write(xml);
  res.end();

  return { props: {} };
};

export default function Sitemap() {
  return null;
}
