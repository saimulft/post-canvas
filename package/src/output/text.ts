// Plain-text helpers over Tiptap JSON: plain text, an excerpt, the cover picture and the transient-content check. Pure
// JSON walks, with no schema and no DOM, so they work anywhere and on any document.
import type { CoverImage, JSONContent } from '../core/types';
import { isStagedSrc, safeMediaSrc } from '../core/url';
import { textLimits } from '../media/rules';
import { cleanLine, cleanPlaceholder, cleanSrcset, cleanUploadId } from '../media/sanitize';
import { embedRender, linkCardRender, videoRender } from '../embeds/render-spec';

type Attrs = Record<string, unknown>;

function attrsOf(node: JSONContent): Attrs {
  return node.attrs && typeof node.attrs === 'object' ? node.attrs : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const blockSeparators: Record<string, string> = {
  listItem: '\n',
  taskItem: '\n',
  tableRow: '\n',
  tableCell: ' | ',
  tableHeader: ' | ',
};

const textBlocks = new Set(['paragraph', 'heading', 'codeBlock']);

function inlineText(node: JSONContent, depth = 0): string {
  if (depth > 100) return '';
  if (node.type === 'text') return str(node.text);
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') {
    const attrs = attrsOf(node);
    const char = attrs.mentionSuggestionChar === '#' ? '#' : '@';
    return `${char}${str(attrs.label) || str(attrs.id)}`;
  }
  return childrenOf(node)
    .map((child) => inlineText(child, depth + 1))
    .join('');
}

/** The text a block-level media or embed node stands for, or `null` for any other node. */
function atomText(node: JSONContent): string | null {
  const attrs = attrsOf(node);
  switch (node.type) {
    case 'image':
      return str(attrs.caption) || str(attrs.alt);
    case 'gallery':
      return str(attrs.caption);
    case 'file':
      return str(attrs.name);
    case 'video': {
      const video = videoRender(attrs);
      return video ? [video.title, video.canonical].filter(Boolean).join('\n') : '';
    }
    case 'embed': {
      const embed = embedRender(attrs);
      return embed ? [embed.title, embed.canonical].filter(Boolean).join('\n') : '';
    }
    case 'linkCard': {
      const card = linkCardRender(attrs);
      return card ? `${card.title}\n${card.url}` : '';
    }
    case 'embedInput':
    case 'horizontalRule':
      return '';
    default:
      return null;
  }
}

function blockText(node: JSONContent, depth = 0): string {
  if (depth > 100) return '';
  const atom = atomText(node);
  if (atom !== null) return atom;
  if (node.type && textBlocks.has(node.type)) return inlineText(node);
  const children = childrenOf(node);
  if (children.length === 0) return node.type === 'text' ? str(node.text) : '';
  if (children.every((child) => child.type === 'text' || child.type === 'hardBreak' || child.type === 'mention')) {
    return inlineText(node);
  }
  const separator = children[0]?.type ? (blockSeparators[children[0].type] ?? '\n\n') : '\n\n';
  return children
    .map((child) => {
      const text = blockText(child, depth + 1);
      if (child.type === 'taskItem') return `[${attrsOf(child).checked === true ? 'x' : ' '}] ${text}`;
      return text;
    })
    .filter((text) => text !== '')
    .join(separator);
}

/** The document as plain text: blocks separated by blank lines, list items and table rows by line breaks. */
export function toPlainText(json: JSONContent): string {
  return blockText(json)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstText(node: JSONContent, depth = 0): string | null {
  if (depth > 100) return null;
  if (node.type && textBlocks.has(node.type) && node.type !== 'codeBlock') {
    const text = inlineText(node).replace(/\s+/g, ' ').trim();
    if (/[\p{L}\p{N}]/u.test(text)) return text;
    return null;
  }
  for (const child of childrenOf(node)) {
    const found = firstText(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The first paragraph or heading with words in it, on one line and cut at a word boundary to `max` characters. */
export function excerpt(json: JSONContent, max = 160): string {
  const text = firstText(json);
  if (!text) return '';
  if (text.length <= max) return text;
  // Leave room for the ellipsis, and never end on half of a surrogate pair.
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  let cut = space > 0 ? head.slice(0, space) : head.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function coverFrom(source: Attrs): CoverImage | null {
  const src = safeMediaSrc(source.src);
  const width = typeof source.width === 'number' && source.width > 0 ? source.width : 0;
  const height = typeof source.height === 'number' && source.height > 0 ? source.height : 0;
  if (!src || !width || !height) return null;
  return {
    src,
    width,
    height,
    alt: cleanLine(source.alt, textLimits.alt),
    srcset: cleanSrcset(source.srcset),
    placeholder: cleanPlaceholder(source.placeholder),
    uploadId: cleanUploadId(source.uploadId),
  };
}

/** The child nodes of a node from untrusted JSON: only plain objects, only from a real array. */
function childrenOf(node: JSONContent): JSONContent[] {
  const content: unknown = node.content;
  return Array.isArray(content)
    ? content.filter((child): child is JSONContent => !!child && typeof child === 'object' && !Array.isArray(child))
    : [];
}

/** Visits every node depth-first without recursion, so a hostile document can't overflow the stack. */
function walk(node: JSONContent, visit: (node: JSONContent) => boolean | void): boolean {
  const stack: JSONContent[] = [node];
  let visited = 0;
  while (stack.length > 0 && visited < 1_000_000) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    visited++;
    if (visit(current) === true) return true;
    const children = childrenOf(current);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index] as JSONContent);
  }
  return false;
}

/**
 * The document's cover picture: the first image or gallery photo, or else the first video thumbnail. `null` when there
 * is neither.
 */
export function getCover(json: JSONContent): CoverImage | null {
  let cover: CoverImage | null = null;
  walk(json, (node) => {
    const attrs = attrsOf(node);
    if (node.type === 'image') cover = coverFrom(attrs);
    else if (
      node.type === 'gallery' &&
      Array.isArray(attrs.photos) &&
      attrs.photos[0] &&
      typeof attrs.photos[0] === 'object'
    ) {
      cover = coverFrom(attrs.photos[0] as Attrs);
    }
    return cover !== null;
  });
  if (cover) return cover;
  walk(json, (node) => {
    if (node.type !== 'video') return false;
    const video = videoRender(attrsOf(node));
    if (!video?.thumbnail) return false;
    const vertical = video.video.vertical;
    cover = {
      src: video.thumbnail,
      width: vertical ? 720 : 1280,
      height: vertical ? 1280 : 720,
      alt: video.title,
      srcset: null,
      placeholder: null,
      uploadId: null,
    };
    return true;
  });
  return cover;
}

function hasTransientValue(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') return /^\s*blob:/i.test(value) || isStagedSrc(value);
  if (Array.isArray(value)) return value.some((item) => hasTransientValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, item]) =>
        (key === 'uploadKey' && item !== null && item !== undefined) || hasTransientValue(item, depth + 1),
    );
  }
  return false;
}

/**
 * True when a document still holds editor-only state that must not be saved: an open paste-a-link field, an upload
 * that is running or failed (`uploadKey`), a `blob:` source or a staged-upload marker. Check it before saving; `sanitizeDocument()` removes
 * all of them.
 */
export function hasTransientContent(json: JSONContent): boolean {
  return walk(json, (node) => node.type === 'embedInput' || hasTransientValue(node.attrs));
}
