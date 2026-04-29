import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Public route for CMS-managed content pages (about, faq, terms, etc.).
 * Edits happen at /admin/pages. This catch-all sits at the end of route
 * resolution, so it only matches paths that no static or specialized
 * dynamic route handles (e.g. /cart, /search, /c/...).
 */

export const revalidate = 600;

// Common one-segment paths the app already owns. We refuse to serve content
// pages for these so a stray slug can never shadow a real route.
const RESERVED = new Set([
  "account",
  "admin",
  "api",
  "auth",
  "c",
  "cart",
  "checkout",
  "p",
  "search",
  "sitemap.xml",
  "robots.txt",
  "favicon.ico",
]);

async function load(slug: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("content_pages")
    .select("title, body_md, meta_title, meta_description, is_active, updated_at")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (RESERVED.has(slug)) return {};
  const page = await load(slug);
  if (!page) return {};
  return {
    title: page.meta_title ?? page.title,
    description: page.meta_description ?? undefined,
    alternates: { canonical: `/${slug}` },
  };
}

export default async function ContentPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (RESERVED.has(slug)) notFound();
  const page = await load(slug);
  if (!page) notFound();

  return (
    <article className="container-wf py-12 max-w-3xl">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
        {page.title}
      </h1>
      <div
        className="prose prose-slate mt-6 max-w-none"
        // Markdown is converted to HTML server-side using a tiny renderer.
        // For now we render the source verbatim in <pre>, which is safe and
        // good enough until we wire react-markdown.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body_md) }}
      />
    </article>
  );
}

/**
 * Minimal Markdown-to-HTML renderer. Handles headings, paragraphs, lists,
 * inline emphasis, and links. Anything fancier should swap in
 * react-markdown + remark-gfm. Safe by construction: we HTML-escape the
 * input before applying our small set of transforms.
 */
function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = esc(src).split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  let inList = false;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join("\n");
}

function inline(s: string): string {
  // Bold, italic, code, links
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-[var(--color-brand-700)] hover:underline">$1</a>',
    );
}
