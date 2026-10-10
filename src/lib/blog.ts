import fs from 'fs';
import path from 'path';
import { Marked } from 'marked';

/** Server-only: reads Markdown posts from src/content/blog. */

const BLOG_DIR = path.join(process.cwd(), 'src/content/blog');

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated: string | null;
  author: string;
  tags: string[];
  readingMinutes: number;
}

export interface PostHeading {
  id: string;
  text: string;
  depth: number;
}

export interface Post extends PostMeta {
  html: string;
  headings: PostHeading[];
}

const parseFrontmatter = (raw: string) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return { data: {} as Record<string, string>, body: raw };
  }
  const data: Record<string, string> = {};
  (match[1] ?? '').split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(':');
    if (separator > 0) {
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      data[key] = value;
    }
  });
  return { data, body: raw.slice(match[0].length) };
};

/** Accepts 2024/3/17 or 2024-03-17 and returns 2024-03-17. */
const normalizeDate = (value: string | undefined) => {
  const parts = (value ?? '').split(/[-/]/).map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts;
  if (!year || !month || !day) {
    return '1970-01-01';
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const toMeta = (slug: string, raw: string) => {
  const { data, body } = parseFrontmatter(raw);
  const words = body.split(/\s+/).filter(Boolean).length;
  const meta: PostMeta = {
    slug,
    title: data.title ?? slug,
    description: data.description ?? '',
    date: normalizeDate(data.date),
    updated: data.updated ? normalizeDate(data.updated) : null,
    author: data.author ?? 'KM Koushik',
    tags: (data.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    readingMinutes: Math.max(1, Math.round(words / 220)),
  };
  return { meta, body };
};

const readPostFile = (slug: string) => {
  const file = path.join(BLOG_DIR, `${slug}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

export const getPostSlugs = () =>
  fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/, ''));

export const getAllPosts = (): PostMeta[] =>
  getPostSlugs()
    .map((slug) => toMeta(slug, readPostFile(slug) ?? '').meta)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

export const getPost = (slug: string): Post | null => {
  const raw = readPostFile(slug);
  if (null === raw) {
    return null;
  }
  const { meta, body } = toMeta(slug, raw);
  const headings: PostHeading[] = [];

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (2 === depth || 3 === depth) {
          headings.push({ id, text: text.replace(/<[^>]+>/g, ''), depth });
        }
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.startsWith('https://splitpro.app');
        const titleAttribute = title ? ` title="${title}"` : '';
        const targetAttribute = external ? ' target="_blank" rel="noreferrer"' : '';
        return `<a href="${href}"${titleAttribute}${targetAttribute}>${text}</a>`;
      },
    },
  });

  const html = marked.parse(body, { async: false });
  return { ...meta, html, headings };
};
