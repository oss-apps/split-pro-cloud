import { ArrowLeft } from 'lucide-react';
import { type GetStaticPaths, type GetStaticProps } from 'next';
import Link from 'next/link';
import {
  COMPARE_PATH,
  COMPARISONS,
  type Comparison,
  getComparison,
} from '~/components/Compare/content';
import { CtaBand, Faq } from '~/components/Site/blocks';
import { ISSUES_URL, SITE_URL } from '~/components/Site/constants';
import { formatPostDate } from '~/components/Site/PostCard';
import { Seo, faqJsonLd } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';

const ComparePage: React.FC<{ comparison: Comparison }> = ({ comparison }) => {
  const path = `${COMPARE_PATH}/${comparison.slug}`;
  const title = `SplitPro vs ${comparison.competitor}`;
  const others = COMPARISONS.filter((c) => c.slug !== comparison.slug);

  return (
    <SiteLayout>
      <Seo
        title={comparison.seoTitle}
        description={comparison.description}
        path={path}
        type="article"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: title,
            description: comparison.description,
            dateModified: comparison.reviewed,
            author: { '@type': 'Organization', name: 'SplitPro', url: SITE_URL },
            publisher: { '@type': 'Organization', name: 'SplitPro', url: SITE_URL },
            mainEntityOfPage: `${SITE_URL}${path}`,
            image: `${SITE_URL}/og_banner.png`,
          },
          faqJsonLd(comparison.faqs),
        ]}
      />
      <div className="mx-auto max-w-4xl px-5 pt-12 sm:pt-16 lg:px-8">
        <Link
          href={COMPARE_PATH}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All comparisons
        </Link>
        <h1 className="mt-8 text-balance text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-gray-400">
          {comparison.description}
        </p>
        <p className="mt-4 text-sm text-gray-500">
          Last checked{' '}
          <time dateTime={comparison.reviewed}>{formatPostDate(comparison.reviewed)}</time>.
          SplitPro is our app, so we link every claim about {comparison.competitor} to its own pages
          below.
        </p>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-white">The short answer</h2>
          {comparison.summary.map((paragraph) => (
            <p key={paragraph} className="mt-4 text-pretty leading-relaxed text-gray-300">
              {paragraph}
            </p>
          ))}
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Side by side</h2>
          <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-white/10 text-gray-400">
                <tr>
                  <th scope="col" className="px-5 py-3 font-normal">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-white">
                    SplitPro
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-gray-300">
                    {comparison.competitor}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.label} className="border-b border-white/5 last:border-0">
                    <th scope="row" className="px-5 py-3 font-normal text-gray-300">
                      {row.label}
                    </th>
                    <td className="px-5 py-3 text-white">{row.splitpro}</td>
                    <td className="px-5 py-3 text-gray-400">{row.competitor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            “Not listed” means we could not find it on {comparison.competitor}’s own pages.
          </p>
        </section>

        <section className="mt-14 grid gap-10 md:grid-cols-2">
          <StrengthList
            title={`Where ${comparison.competitor} is stronger`}
            items={comparison.competitorStrengths}
          />
          <StrengthList title="Where SplitPro is stronger" items={comparison.splitproStrengths} />
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Which should you pick?
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 p-6">
              <p className="font-medium text-white">Pick SplitPro if</p>
              <p className="mt-2 leading-relaxed text-gray-400">{comparison.chooseSplitPro}</p>
            </div>
            <div className="rounded-xl border border-white/10 p-6">
              <p className="font-medium text-white">Pick {comparison.competitor} if</p>
              <p className="mt-2 leading-relaxed text-gray-400">{comparison.chooseCompetitor}</p>
            </div>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Common questions</h2>
          <div className="mt-6">
            <Faq items={comparison.faqs} />
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold text-white">Sources</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {comparison.sources.map((source) => (
              <li key={source.href}>
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-400 underline underline-offset-4 hover:text-white"
                >
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-gray-500">
            Apps change their plans and features. If something here is out of date, please{' '}
            <a
              href={ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-gray-300"
            >
              tell us
            </a>{' '}
            and we will fix it.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold text-white">Other comparisons</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`${COMPARE_PATH}/${other.slug}`}
                  className="text-primary hover:underline"
                >
                  SplitPro vs {other.competitor}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="mt-24">
        <CtaBand />
      </div>
    </SiteLayout>
  );
};

const StrengthList: React.FC<{ title: string; items: readonly string[] }> = ({ title, items }) => (
  <div>
    <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
    <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-gray-300 marker:text-gray-500">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
);

export const getStaticPaths: GetStaticPaths = () => ({
  paths: COMPARISONS.map((c) => ({ params: { slug: c.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<{ comparison: Comparison }> = ({ params }) => {
  const comparison = getComparison(typeof params?.slug === 'string' ? params.slug : '');
  if (!comparison) {
    return { notFound: true };
  }
  return { props: { comparison } };
};

export default ComparePage;
