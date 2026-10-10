import { CtaBand, Eyebrow, ToolCards } from '~/components/Site/blocks';
import { SITE_URL, TOOLS } from '~/components/Site/constants';
import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';

const DESCRIPTION =
  'Free calculators for splitting money with friends: settle up after a trip, split a restaurant bill with tax and tip, and split rent by room size or income. No sign-up.';

const ToolsPage = () => (
  <SiteLayout>
    <Seo
      title="Free expense splitting calculators | SplitPro"
      description={DESCRIPTION}
      path="/tools"
      jsonLd={{
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: TOOLS.map((tool, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: tool.name,
          url: `${SITE_URL}${tool.href}`,
        })),
      }}
    />
    <section className="mx-auto max-w-6xl px-5 pt-16 text-center sm:pt-24 lg:px-8">
      <Eyebrow>Free · No sign-up</Eyebrow>
      <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
        Calculators for every “who owes what?”
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-gray-400">
        Quick answers for trips, dinners and shared homes. Everything runs in your browser, and you
        can share the result with a link.
      </p>
      <div className="mt-14 text-left">
        <ToolCards />
      </div>
    </section>
    <div className="mt-32">
      <CtaBand />
    </div>
  </SiteLayout>
);

export default ToolsPage;
