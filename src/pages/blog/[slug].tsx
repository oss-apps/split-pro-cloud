import { ArrowLeft } from 'lucide-react';
import { type GetStaticPaths, type GetStaticProps } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { PrimaryLink, SecondaryLink } from '~/components/Site/blocks';
import { AUTHOR_URL, QUICK_SPLIT_PATH, SITE_URL } from '~/components/Site/constants';
import { PostCard, formatPostDate } from '~/components/Site/PostCard';
import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';
import { type Post, type PostMeta, getAllPosts, getPost, getPostSlugs } from '~/lib/blog';

const BlogPost: React.FC<{ post: Post; related: PostMeta[] }> = ({ post, related }) => (
  <SiteLayout>
    <Seo
      title={`${post.title} | SplitPro`}
      description={post.description}
      path={`/blog/${post.slug}`}
      type="article"
      jsonLd={{
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.updated ?? post.date,
        author: { '@type': 'Person', name: post.author, url: AUTHOR_URL },
        publisher: { '@type': 'Organization', name: 'SplitPro', url: SITE_URL },
        mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
        image: `${SITE_URL}/og_banner.png`,
      }}
    />
    <div className="mx-auto max-w-6xl px-5 pt-12 sm:pt-16 lg:px-8">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All posts
      </Link>
      <div className="mt-8 grid gap-12 xl:grid-cols-[minmax(0,1fr)_220px]">
        <article className="mx-auto w-full max-w-3xl xl:mx-0">
          <header>
            {post.tags.length ? (
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-2.5 py-1 text-xs text-cyan-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
              {post.title}
            </h1>
            {post.description ? (
              <p className="mt-5 text-pretty text-lg leading-relaxed text-gray-400 sm:text-xl">
                {post.description}
              </p>
            ) : null}
            <div className="mt-8 flex items-center gap-3 border-b border-white/[0.07] pb-8 text-sm">
              <Image
                src="/logo_circle.png"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-full ring-1 ring-white/10"
              />
              <div>
                <p className="font-medium text-gray-200">{post.author}</p>
                <p className="text-gray-500">
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time> ·{' '}
                  {post.readingMinutes} min read
                </p>
              </div>
            </div>
          </header>
          <div
            className="prose prose-lg prose-invert mt-10 max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight prose-h2:mt-14 prose-h2:text-[1.65rem] prose-p:leading-[1.8] prose-p:text-gray-300 prose-a:font-normal prose-a:text-cyan-300 prose-a:underline-offset-4 hover:prose-a:text-cyan-200 prose-blockquote:border-cyan-400/50 prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-gray-300 prose-strong:text-white prose-li:text-gray-300 prose-li:marker:text-gray-500 prose-table:text-base prose-th:text-gray-200 prose-td:text-gray-300 prose-hr:border-white/10"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />
          <aside className="mt-16 overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.1] to-transparent p-8">
            <p className="text-xl font-semibold text-white">
              Split your next expense with SplitPro
            </p>
            <p className="mt-2 text-gray-400">
              Free and open source, with no limit on how many expenses you add.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <PrimaryLink href="/auth/signin">Start splitting for free</PrimaryLink>
              <SecondaryLink href={QUICK_SPLIT_PATH}>Try a quick split</SecondaryLink>
            </div>
          </aside>
        </article>
        {post.headings.length > 2 ? (
          <nav aria-label="On this page" className="hidden xl:block">
            <div className="sticky top-24">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-gray-500">
                On this page
              </p>
              <ul className="mt-4 space-y-2.5 border-l border-white/[0.07] text-sm">
                {post.headings.map((heading) => (
                  <li key={heading.id} className={3 === heading.depth ? 'pl-7' : 'pl-4'}>
                    <a
                      href={`#${heading.id}`}
                      className="block leading-snug text-gray-400 transition-colors hover:text-white"
                    >
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        ) : null}
      </div>
      {related.length ? (
        <section className="mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Keep reading</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {related.map((item) => (
              <PostCard key={item.slug} post={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  </SiteLayout>
);

export const getStaticPaths: GetStaticPaths = () => ({
  paths: getPostSlugs().map((slug) => ({ params: { slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<{ post: Post; related: PostMeta[] }> = ({ params }) => {
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  const post = getPost(slug);
  if (!post) {
    return { notFound: true };
  }
  const others = getAllPosts().filter((p) => p.slug !== slug);
  const sameTag = others.filter((p) => p.tags.some((tag) => post.tags.includes(tag)));
  const related = [...sameTag, ...others.filter((p) => !sameTag.includes(p))].slice(0, 3);
  return { props: { post, related } };
};

export default BlogPost;
