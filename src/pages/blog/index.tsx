import { type GetStaticProps } from 'next';
import { CtaBand } from '~/components/Site/blocks';
import { SITE_URL } from '~/components/Site/constants';
import { PostCard } from '~/components/Site/PostCard';
import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';
import { type PostMeta, getAllPosts } from '~/lib/blog';

const DESCRIPTION =
  'Guides on splitting rent, trips and shared costs fairly, moving off Splitwise, and how SplitPro works.';

const BlogIndex: React.FC<{ posts: PostMeta[] }> = ({ posts }) => {
  return (
    <SiteLayout>
      <Seo
        title="SplitPro blog: guides to sharing money fairly"
        description={DESCRIPTION}
        path="/blog"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Blog',
          name: 'SplitPro blog',
          url: `${SITE_URL}/blog`,
          blogPost: posts.map((post) => ({
            '@type': 'BlogPosting',
            headline: post.title,
            url: `${SITE_URL}/blog/${post.slug}`,
            datePublished: post.date,
          })),
        }}
      />
      <section className="mx-auto max-w-6xl px-5 pt-14 sm:pt-20 lg:px-8">
        <div className="max-w-2xl">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Blog
          </h1>
          <p className="mt-3 text-pretty text-lg leading-relaxed text-gray-400">{DESCRIPTION}</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
      <div className="mt-24">
        <CtaBand />
      </div>
    </SiteLayout>
  );
};

export const getStaticProps: GetStaticProps<{ posts: PostMeta[] }> = () => ({
  props: { posts: getAllPosts() },
});

export default BlogIndex;
