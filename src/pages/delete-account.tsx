import { type NextPage } from 'next';
import Link from 'next/link';

import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';
import { env } from '~/env';

/** Public page the app stores link to: how to delete a SplitPro account and what happens. */
const DeleteAccount: NextPage<{ feedbackEmail: string }> = ({ feedbackEmail }) => (
  <SiteLayout>
    <Seo
      title="Delete your SplitPro account"
      description="How to delete your SplitPro account and what happens to your data."
      path="/delete-account"
    />
    <div className="mx-auto max-w-3xl px-5 pb-20 lg:px-8">
      <h1 className="mt-14 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Delete your SplitPro account
      </h1>
      <p className="mt-4 text-lg text-gray-400">
        You can delete your SplitPro account yourself, at any time, from the app or the website.
      </p>

      <h2 className="mt-12 text-xl font-semibold text-white">In the SplitPro app</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-6 text-lg text-gray-400">
        <li>Open the Account tab.</li>
        <li>Tap Delete account.</li>
        <li>Enter the code we email you to confirm.</li>
      </ol>

      <h2 className="mt-10 text-xl font-semibold text-white">On the website</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-6 text-lg text-gray-400">
        <li>
          Sign in at{' '}
          <Link href="/account" className="text-primary hover:underline">
            splitpro.app/account
          </Link>
          .
        </li>
        <li>Choose Delete account.</li>
        <li>Enter the code we email you to confirm.</li>
      </ol>

      <h2 className="mt-12 text-xl font-semibold text-white">What gets deleted</h2>
      <p className="mt-3 text-lg text-gray-400">
        Your name, email address, profile photo, sign-in methods (Google, Apple, email), sessions,
        notification settings and your friends list are deleted straight away.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-white">What is kept</h2>
      <p className="mt-3 text-lg text-gray-400">
        Expenses you shared with other people stay, so their balances remain correct. They show you
        as &quot;Deleted user&quot;, with no name or email. Groups you created pass to another
        member, or are deleted if nobody else is in them. Deleted data can stay in our encrypted
        backups for a limited time until those backups expire.
      </p>

      {feedbackEmail ? (
        <p className="mt-12 text-lg text-gray-400">
          Can&apos;t sign in any more? Email{' '}
          <a className="text-primary hover:underline" href={'mailto:' + feedbackEmail}>
            {feedbackEmail}
          </a>{' '}
          from the address on your account and we&apos;ll delete it for you.
        </p>
      ) : null}
    </div>
  </SiteLayout>
);

export default DeleteAccount;

export const getServerSideProps = () => ({
  props: { feedbackEmail: env.FEEDBACK_EMAIL ?? '' },
});
