import { type GetStaticProps } from 'next';
import { CtaBand, Eyebrow } from '~/components/Site/blocks';
import { SITE_URL } from '~/components/Site/constants';
import { PostCard } from '~/components/Site/PostCard';
import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';
import { type PostMeta, getAllPosts } from '~/lib/blog';

const DESCRIPTION =
  'Guides on splitting rent, trips and shared costs fairly, moving off Splitwise, and how SplitPro works.';

const BlogIndex: React.FC<{ posts: PostMeta[] }> = ({ posts }) => {
  const [featured, ...rest] = posts;
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
      <section className="mx-auto max-w-6xl px-5 pt-16 sm:pt-24 lg:px-8">
        <div className="max-w-2xl">
          <Eyebrow>Blog</Eyebrow>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Sharing money, without the awkward part
          </h1>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-gray-400">{DESCRIPTION}</p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {featured ? <PostCard post={featured} featured /> : null}
          {rest.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
      <div className="mt-32">
        <CtaBand />
      </div>
    </SiteLayout>
  );
};

export const getStaticProps: GetStaticProps<{ posts: PostMeta[] }> = () => ({
  props: { posts: getAllPosts() },
});

export default BlogIndex;
