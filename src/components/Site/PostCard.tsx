import Link from 'next/link';
import type { PostMeta } from '~/lib/blog';

export const formatPostDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

export const PostCard: React.FC<{ post: PostMeta }> = ({ post }) => (
  <Link
    href={`/blog/${post.slug}`}
    className="group flex flex-col rounded-xl border border-white/10 p-6 transition-colors hover:border-white/20 hover:bg-white/[0.02]"
  >
    {post.tags[0] ? <p className="text-xs font-medium text-gray-500">{post.tags[0]}</p> : null}
    <h3 className="mt-2 text-balance text-lg font-medium leading-snug text-white group-hover:text-primary">
      {post.title}
    </h3>
    <p className="mt-2 line-clamp-3 text-pretty text-sm leading-relaxed text-gray-400">
      {post.description}
    </p>
    <p className="mt-auto pt-5 text-xs text-gray-500">
      {formatPostDate(post.date)} · {post.readingMinutes} min read
    </p>
  </Link>
);
