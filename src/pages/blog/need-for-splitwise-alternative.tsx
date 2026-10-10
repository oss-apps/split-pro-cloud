import { type NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { Separator } from '~/components/ui/separator';

const TITLE = 'A need for open source splitwise alternative';

const BlogPost: NextPage = () => {
  return (
    <>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={TITLE} />
        <meta name="author" content="KM Koushik" />
      </Head>
      <main className="mx-auto max-w-3xl px-4 pb-20 lg:px-0">
        <nav className="flex items-center justify-between py-4 lg:py-5">
          <Link href="/">
            <p className="text-2xl font-medium">SplitPro</p>
          </Link>
        </nav>

        <article className="mt-12 text-lg leading-8 text-gray-300">
          <h1 className="text-3xl font-bold text-white">{TITLE}</h1>
          <p className="mt-2 text-sm text-gray-400">
            <time dateTime="2024-03-17">March 17, 2024</time> by KM Koushik
          </p>

          <p className="mt-8">
            Splitwise doesn&apos;t need an introduction. It&apos;s a popular app for managing shared
            expenses. It&apos;s advertised as a free tool but they slowly started charging money for
            very basic features like adding more than 3 expenses in a day.
          </p>
          <p className="mt-6">
            Don&apos;t get me wrong, I&apos;m fine with products charging money. After all,
            splitwise is a very good product and lot&apos;s of effort has been put on the product.
            But the problem is locking you after you&apos;ve used the product for a long time and
            charge for features that doesn&apos;t convert to the value they provide.
          </p>
          <p className="mt-6">
            I will happily pay for the pro features, but this really frustrates me.
          </p>

          <h2 className="mt-12 text-2xl font-semibold text-white">Okay, what now?</h2>
          <p className="mt-6">
            Creating an open source alternative is very important now. Any closed source alternative
            might do the same and I don&apos;t have any reason to believe otherwise. This will force
            us to create a better product and makes it hard to be evil. After all we will have an
            option to host the solution ourselves.
          </p>
          <p className="mt-6">
            Splitpro is designed to be an drop in open source replacement for Splitwise with all the
            important features. And completely free to use.
          </p>
          <ul className="mt-6 list-disc space-y-1 pl-6">
            <li>➕ Add expenses with an individual or groups.</li>
            <li>👥 Overall balances across the groups.</li>
            <li>💵 Multiple currency support</li>
            <li>📄 Upload expense bills</li>
            <li>📱 PWA support</li>
            <li>✂️ Split expenses unequally (share, percentage, exact amounts)</li>
            <li>🔔 Push notification</li>
            <li>✅ Settle up expenses</li>
            <li>📲 Import data from Splitwise</li>
          </ul>

          <h2 className="mt-12 text-2xl font-semibold text-white">Will you make it paid?</h2>
          <p className="mt-6">
            Any existing features will not be paid. But I have plans to introduce paid features
            which are not core for this product. This is mainly to fund this project.
          </p>

          <h2 className="mt-12 text-2xl font-semibold text-white">
            How are you running it for free?
          </h2>
          <p className="mt-6">
            I working on a full time job and this is my side project. Even with very high usage,
            splitrpo won&apos;t cost more than $100 a month. I currently can afford this. As I said
            earlier I will add some paid pro features / open up donations to fund the project.
          </p>

          <h2 className="mt-12 text-2xl font-semibold text-white">How can I help?</h2>
          <p className="mt-6">
            Very simple! Use the product, share it with your friends and give feedback. If you want
            to contribute, head to our{' '}
            <a href="https://github.com/oss-apps/split-pro" className="underline">
              github
            </a>{' '}
            repo and open a PR.
          </p>
        </article>

        <footer className="mt-20 flex items-center justify-center gap-4">
          <Link href="https://splitpro.app/balances" target="_blank">
            App
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <Link href="https://github.com/oss-apps/split-pro" target="_blank">
            Github
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <Link href="https://www.producthunt.com/products/splitpro/reviews/new" target="_blank">
            Product Hunt
          </Link>
        </footer>
      </main>
    </>
  );
};

export default BlogPost;
