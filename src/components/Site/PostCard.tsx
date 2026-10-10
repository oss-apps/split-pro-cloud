import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '~/lib/utils';
import type { PostMeta } from '~/lib/blog';

const ACCENTS = [
  'from-cyan-400/30 via-sky-500/10',
  'from-emerald-400/30 via-teal-500/10',
  'from-violet-400/30 via-fuchsia-500/10',
  'from-amber-400/25 via-orange-500/10',
  'from-rose-400/25 via-pink-500/10',
  'from-sky-400/30 via-indigo-500/10',
] as const;

const accentFor = (slug: string) =>
  ACCENTS[[...slug].reduce((acc, char) => acc + char.charCodeAt(0), 0) % ACCENTS.length];

export const formatPostDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

export const PostCard: React.FC<{ post: PostMeta; featured?: boolean }> = ({ post, featured }) => (
  <Link
    href={`/blog/${post.slug}`}
    className={cn(
      'group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition-colors hover:border-white/[0.16]',
      featured && 'md:col-span-2 md:flex-row',
    )}
  >
    <div
      aria-hidden
      className={cn(
        'relative h-36 shrink-0 bg-gradient-to-br to-transparent',
        featured && 'md:h-auto md:w-2/5',
        accentFor(post.slug),
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      {post.tags[0] ? (
        <span className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] font-medium text-gray-200 backdrop-blur">
          {post.tags[0]}
        </span>
      ) : null}
    </div>
    <div className="flex flex-1 flex-col p-6">
      <h3
        className={cn(
          'text-balance font-medium text-white',
          featured ? 'text-2xl leading-snug' : 'text-lg leading-snug',
        )}
      >
        {post.title}
      </h3>
      <p className="mt-3 line-clamp-3 text-pretty text-sm leading-relaxed text-gray-400">
        {post.description}
      </p>
      <div className="mt-auto flex items-center justify-between pt-6 text-xs text-gray-500">
        <span>
          {formatPostDate(post.date)} · {post.readingMinutes} min read
        </span>
        <ArrowUpRight className="h-4 w-4 text-gray-600 transition-colors group-hover:text-cyan-300" />
      </div>
    </div>
  </Link>
);
