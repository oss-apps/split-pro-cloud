import Link from 'next/link';
import { COMPARE_PATH, COMPARISONS } from '~/components/Compare/content';
import { CtaBand } from '~/components/Site/blocks';
import { SITE_URL } from '~/components/Site/constants';
import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';

const DESCRIPTION =
  'Honest, side-by-side comparisons of SplitPro with other apps for splitting expenses: what each does well, what it costs, and who it suits.';

const CompareIndex = () => (
  <SiteLayout>
    <Seo
      title="Compare SplitPro with Splitwise, Tricount and Settle Up | SplitPro"
      description={DESCRIPTION}
      path={COMPARE_PATH}
      jsonLd={{
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'SplitPro comparisons',
        url: `${SITE_URL}${COMPARE_PATH}`,
        hasPart: COMPARISONS.map((c) => ({
          '@type': 'Article',
          headline: `SplitPro vs ${c.competitor}`,
          url: `${SITE_URL}${COMPARE_PATH}/${c.slug}`,
        })),
      }}
    />
    <section className="mx-auto max-w-6xl px-5 pt-14 sm:pt-20 lg:px-8">
      <div className="max-w-2xl">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Compare SplitPro
        </h1>
        <p className="mt-3 text-pretty text-lg leading-relaxed text-gray-400">{DESCRIPTION}</p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {COMPARISONS.map((c) => (
          <Link
            key={c.slug}
            href={`${COMPARE_PATH}/${c.slug}`}
            className="group flex flex-col rounded-xl border border-white/10 p-6 transition-colors hover:border-white/20 hover:bg-white/[0.02]"
          >
            <h2 className="text-lg font-medium text-white group-hover:text-primary">
              SplitPro vs {c.competitor}
            </h2>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-gray-400">
              {c.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
    <div className="mt-24">
      <CtaBand />
    </div>
  </SiteLayout>
);

export default CompareIndex;
