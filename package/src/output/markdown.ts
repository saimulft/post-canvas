// Markdown out (GitHub-flavoured, from a pure JSON walk) and Markdown in (through @tiptap/markdown, then sanitized).
import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { defaultFeatures } from '../core/features';
import { postCanvasSchema } from '../core/schema';
import type { Features } from '../core/types';
import { safeHref, safeMediaSrc } from '../core/url';
import { embedRender, linkCardRender, videoRender } from '../embeds/render-spec';
import { sanitizeDocument, type DocumentLimits } from './sanitize';

type Attrs = Record<string, unknown>;
type MarkJSON = NonNullable<JSONContent['marks']>[number];

function attrsOf(node: { attrs?: Record<string, unknown> }): Attrs {
  return node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
}

/** A node's children from untrusted JSON: plain objects from a real array only. */
function kids(node: JSONContent): JSONContent[] {
  const content: unknown = node.content;
  return Array.isArray(content)
    ? content.filter((child): child is JSONContent => !!child && typeof child === 'object' && !Array.isArray(child))
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Escapes characters that would start Markdown syntax inside running text. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>~|])/g, '\\$1');
}

/** Escapes text that starts a line, where `#`, `-`, `+`, `>` and `1.` would start a block. */
function escapeLineStart(text: string): string {
  return text.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/gm, (_, space: string, mark: string) => `${space}\\${mark}`);
}

/**
 * A link destination with everything outside a URL-safe set percent-encoded. A backslash would otherwise escape the
 * next character in Markdown (`javascript\:` reads as `javascript:`), and brackets, spaces and quotes would end it.
 */
function escapeUrl(url: string): string {
  return url.replace(/[^A-Za-z0-9\-._~:/?#@!$&'*+,;=%]/g, (ch) => encodeURIComponent(ch));
}

function link(text: string, url: string): string {
  // Link text is running text: `<` and `>` are escaped too, so a file name or title can't carry raw HTML.
  return `[${escapeText(text || url)}](${escapeUrl(url)})`;
}

// The marks Markdown can show, outermost first. Code is innermost because nothing nests inside it.
const markOrder = ['link', 'bold', 'italic', 'strike', 'code'] as const;
type MdMark = (typeof markOrder)[number];

function open(mark: MdMark): string {
  return { link: '[', bold: '**', italic: '_', strike: '~~', code: '`' }[mark];
}

function close(mark: MdMark, attrs: Attrs): string {
  if (mark === 'link') {
    const href = safeHref(attrs.href);
    return href ? `](${escapeUrl(href)})` : ']()';
  }
  return open(mark);
}

interface OpenMark {
  type: MdMark;
  attrs: Attrs;
  key: string;
}

function marksOf(marks: readonly MarkJSON[] | undefined): OpenMark[] {
  const found = (marks ?? [])
    .filter((mark): mark is MarkJSON & { type: MdMark } => markOrder.includes(mark.type as MdMark))
    .filter((mark) => mark.type !== 'link' || safeHref(attrsOf(mark).href))
    .map((mark) => ({ type: mark.type, attrs: attrsOf(mark), key: `${mark.type}:${str(attrsOf(mark).href)}` }));
  return found.sort((a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type));
}

/** Inline content with marks opened and closed across text nodes, so `**a** **b**` stays valid. */
function inline(nodes: readonly JSONContent[]): string {
  let out = '';
  const stack: OpenMark[] = [];
  const closeTo = (length: number) => {
    const trailing = /\s*$/.exec(out)?.[0] ?? '';
    out = out.slice(0, out.length - trailing.length);
    while (stack.length > length) {
      const mark = stack.pop();
      if (mark) out += close(mark.type, mark.attrs);
    }
    out += trailing;
  };
  for (const node of nodes) {
    const marks = node.type === 'text' ? marksOf(node.marks) : [];
    let common = 0;
    while (common < stack.length && common < marks.length && stack[common]?.key === marks[common]?.key) common++;
    closeTo(common);
    let text: string;
    if (node.type === 'text') {
      text = marks.some((mark) => mark.type === 'code')
        ? str(node.text).replace(/`/g, "'")
        : escapeText(str(node.text));
    } else if (node.type === 'hardBreak') {
      text = '\\\n';
    } else if (node.type === 'mention') {
      const attrs = attrsOf(node);
      text = `${attrs.mentionSuggestionChar === '#' ? '#' : '@'}${escapeText(str(attrs.label) || str(attrs.id))}`;
    } else {
      text = inline(kids(node));
    }
    const leading = marks.length > common ? (/^\s*/.exec(text)?.[0] ?? '') : '';
    out += leading;
    for (const mark of marks.slice(common)) {
      out += open(mark.type);
      stack.push(mark);
    }
    out += text.slice(leading.length);
  }
  closeTo(0);
  return out;
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : by + line))
    .join('\n');
}

function image(source: Attrs): string {
  const src = safeMediaSrc(source.src);
  return src ? `![${escapeText(str(source.alt))}](${escapeUrl(src)})` : '';
}

// A hard break becomes <br> like a paragraph break. Text runs already escape their pipes, so only those inside inline
// code still need it here.
function cellText(cell: JSONContent): string {
  return kids(cell)
    .map((block) => inline(kids(block)))
    .join('<br>')
    .replace(/\\\n/g, '<br>')
    .replace(/(\\*)\|/g, (match, slashes: string) => (slashes.length % 2 === 0 ? `${slashes}\\|` : match))
    .replace(/\n/g, ' ');
}

function table(node: JSONContent): string {
  const rows = kids(node).map((row) => kids(row).map(cellText));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length), 1);
  const pad = (row: string[]) => [...row, ...Array<string>(width - row.length).fill('')];
  const [head = [], ...body] = rows;
  return [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array<string>(width).fill('---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`),
  ].join('\n');
}

function list(node: JSONContent, ordered: boolean): string {
  const start = typeof attrsOf(node).start === 'number' ? (attrsOf(node).start as number) : 1;
  return kids(node)
    .map((item, index) => {
      const marker =
        item.type === 'taskItem'
          ? `- [${attrsOf(item).checked === true ? 'x' : ' '}] `
          : ordered
            ? `${start + index}. `
            : '- ';
      const body = blocks(kids(item), true);
      return marker + indent(body, ' '.repeat(ordered ? marker.length : 2));
    })
    .join('\n');
}

function block(node: JSONContent, tight: boolean): string {
  const attrs = attrsOf(node);
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(inline(kids(node)));
    case 'heading': {
      const level = typeof attrs.level === 'number' ? Math.min(Math.max(attrs.level, 1), 6) : 2;
      return `${'#'.repeat(level)} ${inline(kids(node))}`;
    }
    case 'blockquote':
      return blocks(kids(node), false)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'bulletList':
    case 'taskList':
      return list(node, false);
    case 'orderedList':
      return list(node, true);
    case 'codeBlock': {
      const code = kids(node)
        .map((child) => str(child.text))
        .join('');
      // One backtick longer than the longest run inside, so nothing in the code can close the fence (CommonMark).
      const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (run) => run[0].length));
      const fence = '`'.repeat(longest + 1);
      const language = /^[a-z0-9+#-]{1,20}$/.test(str(attrs.language)) ? str(attrs.language) : '';
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    case 'table':
      return table(node);
    case 'image': {
      const picture = image(attrs);
      return [picture, str(attrs.caption) && `_${escapeText(str(attrs.caption))}_`].filter(Boolean).join('\n');
    }
    case 'gallery': {
      const photos = Array.isArray(attrs.photos) ? (attrs.photos as unknown[]) : [];
      const items = photos
        .map((photo) => (photo && typeof photo === 'object' ? image(photo as Attrs) : ''))
        .filter(Boolean)
        .map((picture) => `- ${picture}`);
      return [...items, str(attrs.caption) && `\n_${escapeText(str(attrs.caption))}_`].filter(Boolean).join('\n');
    }
    case 'file': {
      const src = safeMediaSrc(attrs.src);
      return src ? link(str(attrs.name) || src, src) : '';
    }
    case 'video': {
      const video = videoRender(attrs);
      return video ? link(video.title || `${video.provider.label} video`, video.canonical) : '';
    }
    case 'embed': {
      const embed = embedRender(attrs);
      return embed ? link(embed.title || embed.provider.label, embed.canonical) : '';
    }
    case 'linkCard': {
      const card = linkCardRender(attrs);
      return card ? link(card.title, card.url) : '';
    }
    case 'embedInput':
      return '';
    default:
      if (kids(node).some((child) => child.type === 'text')) return inline(kids(node));
      return blocks(kids(node), tight);
  }
}

function blocks(nodes: readonly JSONContent[], tight: boolean): string {
  return nodes
    .map((node) => block(node, tight))
    .filter((text) => text !== '')
    .join(tight ? '\n' : '\n\n');
}

/**
 * The document as GitHub-flavoured Markdown. Galleries become a list of images; videos, embeds and link cards become a
 * link on their own line; tables become GFM tables; mentions and hashtags become `@label` and `#label`. Formatting
 * Markdown can't show, such as underline or colour, is left out.
 */
export function toMarkdown(json: JSONContent): string {
  return `${blocks(kids(json), false).trim()}\n`;
}

/** Options of `fromMarkdown()`. */
export interface FromMarkdownOptions {
  features?: Features;
  limits?: Partial<DocumentLimits>;
}

const managers = new Map<string, MarkdownManager>();

/**
 * Reads Markdown into a sanitized document, through `@tiptap/markdown`. Syntax for nodes the features turn off ends up
 * as plain text.
 */
export function fromMarkdown(markdown: string, options: FromMarkdownOptions = {}): JSONContent {
  const features = options.features ?? defaultFeatures;
  const key = JSON.stringify(features);
  let manager = managers.get(key);
  if (!manager) {
    manager = new MarkdownManager({ extensions: postCanvasSchema(features) });
    if (managers.size > 20) managers.clear();
    managers.set(key, manager);
  }
  let parsed: JSONContent;
  try {
    parsed = manager.parse(markdown);
  } catch {
    parsed = {
      type: 'doc',
      content: markdown
        .split(/\n{2,}/)
        .filter((part) => part.trim())
        .map((part) => ({ type: 'paragraph', content: [{ type: 'text', text: part.trim() }] })),
    };
  }
  return sanitizeDocument(parsed, { features, limits: options.limits }).doc;
}
