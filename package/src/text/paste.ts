'use client';
// Clean pasting from Word, Google Docs and the web: keep the structure (headings, lists, tables, links, bold and the
// like), drop the noise (styles, classes, Office markup, scripts, handlers). Plain text keeps its paragraphs.
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Mark, type Node as PmNode, type ResolvedPos, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { sanitizersFor } from '../core/registry';
import type { AttrsSanitizer } from '../core/types';
import { safeHref, safeMediaSrc } from '../core/url';
import { codeLanguage } from './sanitize';

// Elements removed with everything inside them.
const dropped = new Set([
  'script',
  'style',
  'meta',
  'link',
  'title',
  'head',
  'xml',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'source',
  'base',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'listing',
  'o:p',
]);

// Elements whose inline styles may become marks: inline wrappers and text blocks, never containers like tables or lists.
const styledTags = new Set(['span', 'font', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const listTypes = new Set(['1', 'a', 'A', 'i', 'I']);

/** The deepest ProseMirror clipboard context accepted from pasted HTML. Deeper ones are dropped. */
const maxSliceContext = 40;

// Elements replaced by their children, once they have no data attributes left.
const unwrapped = new Set(['font', 'center', 'span', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside']);

// Attributes kept per element, besides `data-*`.
const keptAttributes: Record<string, readonly string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  ol: ['start', 'type'],
};

/** True for Office, Google Docs or other namespaced elements such as `o:p`, `w:sdt` and `v:shape`. */
function isNamespaced(tag: string): boolean {
  return tag.includes(':');
}

function styleOf(element: Element): string {
  return (element.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '');
}

/** An element's inline style declarations, by property name (lower-case, spaces removed). */
function declarations(element: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of styleOf(element).split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) map.set(part.slice(0, colon), part.slice(colon + 1).replace(/!important$/, ''));
  }
  return map;
}

/** Wraps an element's children in a new element. */
function wrapChildren(element: Element, tag: string): void {
  const doc = element.ownerDocument;
  const wrapper = doc.createElement(tag);
  while (element.firstChild) wrapper.appendChild(element.firstChild);
  element.appendChild(wrapper);
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

function rename(element: Element, tag: string): Element {
  const doc = element.ownerDocument;
  const next = doc.createElement(tag);
  for (const attr of Array.from(element.attributes)) next.setAttribute(attr.name, attr.value);
  while (element.firstChild) next.appendChild(element.firstChild);
  element.parentNode?.replaceChild(next, element);
  return next;
}

/** Turns inline styles that carry meaning (bold, italic, underline, strike, super and subscript) into tags. */
function semanticStyles(element: Element): void {
  const style = declarations(element);
  if (style.size === 0) return;
  const tag = element.tagName.toLowerCase();
  if (!styledTags.has(tag)) return;
  const weight = style.get('font-weight') ?? '';
  if ((weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) && tag !== 'b' && tag !== 'strong')
    wrapChildren(element, 'strong');
  if (style.get('font-style') === 'italic' && tag !== 'i' && tag !== 'em') wrapChildren(element, 'em');
  const decoration = `${style.get('text-decoration') ?? ''} ${style.get('text-decoration-line') ?? ''}`;
  if (decoration.includes('underline') && tag !== 'u' && !element.closest('a')) wrapChildren(element, 'u');
  if (decoration.includes('line-through') && tag !== 's') wrapChildren(element, 's');
  const align = style.get('vertical-align');
  if (align === 'super') wrapChildren(element, 'sup');
  if (align === 'sub') wrapChildren(element, 'sub');
}

function isEmptyBlock(element: Element): boolean {
  if (element.querySelector('img, br, hr, table')) return false;
  return (element.textContent ?? '').replace(/[\s\u00a0\u200b]/g, '') === '';
}

/** Word writes lists as `<p style="mso-list:l0 level1">` paragraphs with a marker span. Rebuild real lists. */
function rebuildWordLists(body: Element): void {
  const doc = body.ownerDocument;
  const paragraphs = Array.from(body.querySelectorAll('p')).filter((p) => /mso-list:/.test(styleOf(p)));
  const handled = new Set<Element>();
  for (const first of paragraphs) {
    if (handled.has(first)) continue;
    // A run of list paragraphs that sit next to each other.
    const run: Element[] = [];
    let node: Element | null = first;
    while (node && node.tagName.toLowerCase() === 'p' && /mso-list:/.test(styleOf(node))) {
      run.push(node);
      handled.add(node);
      node = node.nextElementSibling;
    }
    const stack: { list: Element; level: number; id: string }[] = [];
    const container = doc.createElement('div');
    first.parentNode?.insertBefore(container, first);
    for (const p of run) {
      const level = Number(/level(\d+)/.exec(styleOf(p))?.[1] ?? '1');
      const id = /mso-list:(l\d+)/.exec(styleOf(p))?.[1] ?? '';
      const marker = Array.from(p.querySelectorAll('span')).find(
        (span) => declarations(span).get('mso-list') === 'ignore',
      );
      const markerText = (marker?.textContent ?? '').replace(/[\s\u00a0]/g, '');
      marker?.remove();
      const ordered = /^\(?[0-9a-z]{1,4}[.)]$/i.test(markerText);
      while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();
      // Another list (a new Word list id, or bullets turning into numbers) at the same level starts a new list.
      const same = stack[stack.length - 1];
      if (same && same.level === level && (same.id !== id || (same.list.tagName === 'OL') !== ordered)) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        if (top) (top.list.lastElementChild ?? top.list).appendChild(list);
        else container.appendChild(list);
        top = { list, level, id };
        stack.push(top);
      }
      const item = doc.createElement('li');
      const content = doc.createElement('p');
      while (p.firstChild) content.appendChild(p.firstChild);
      item.appendChild(content);
      top.list.appendChild(item);
      p.remove();
    }
    unwrap(container);
  }
}

function clampedInteger(value: string | null, min: number, max: number): string | null {
  const n = Number(value);
  return value !== null && Number.isFinite(n) ? String(Math.min(max, Math.max(min, Math.round(n)))) : null;
}

/** Keeps the allowed attributes only, and makes the kept ones safe. */
function cleanElement(element: Element, { keepSlice = false }: { keepSlice?: boolean } = {}): void {
  const tag = element.tagName.toLowerCase();
  const kept = keptAttributes[tag] ?? [];
  // A code language survives as a single `language-…` class.
  const language =
    tag === 'code' || tag === 'pre'
      ? codeLanguage(
          (element.getAttribute('class') ?? '')
            .split(/\s+/)
            .find((name) => name.startsWith('language-'))
            ?.slice('language-'.length),
        )
      : null;
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const keepData =
      name.startsWith('data-') && (!name.startsWith('data-pm-') || (keepSlice && name === 'data-pm-slice'));
    if (!kept.includes(name) && !keepData) element.removeAttribute(attr.name);
  }
  if (language) element.setAttribute('class', `language-${language}`);
  if (tag === 'a') {
    const href = safeHref(element.getAttribute('href'));
    if (href) element.setAttribute('href', href);
    else element.removeAttribute('href');
  } else if (tag === 'img') {
    const src = safeMediaSrc(element.getAttribute('src'));
    if (src) element.setAttribute('src', src);
    else element.remove();
  } else if (tag === 'td' || tag === 'th') {
    for (const name of ['colspan', 'rowspan']) {
      const value = clampedInteger(element.getAttribute(name), 1, 100);
      if (value) element.setAttribute(name, value);
      else element.removeAttribute(name);
    }
  } else if (tag === 'ol') {
    const start = clampedInteger(element.getAttribute('start'), 0, 1_000_000);
    if (start) element.setAttribute('start', start);
    else element.removeAttribute('start');
    if (!listTypes.has(element.getAttribute('type') ?? '')) element.removeAttribute('type');
  }
}

/**
 * Visits every element after its children (post-order), without recursion, so deeply nested input can't overflow the
 * stack. Comments are removed on the way.
 */
function walk(root: Node, visit: (element: Element) => void): void {
  const order: Element[] = [];
  const stack: Node[] = Array.from(root.childNodes).reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === 8) {
      node.parentNode?.removeChild(node); // comments, conditional comments included
    } else if (node.nodeType === 1) {
      order.push(node as Element);
      const children = Array.from(node.childNodes);
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
  }
  for (let i = order.length - 1; i >= 0; i--) visit(order[i]!);
}

/**
 * Cleans HTML pasted from Word, Google Docs or a web page. Keeps headings, paragraphs, lists, tables, links, quotes,
 * code and inline formatting; removes styles, classes, ids, event handlers, scripts, Office markup and comments. HTML
 * copied from a Post Canvas editor (ProseMirror's own clipboard) keeps its data attributes, so mentions, task lists
 * and media survive a copy within the editor.
 *
 * Needs a DOM (`DOMParser`); on the server, use `fromHTML` from `post-canvas/server` instead.
 */
export function cleanPastedHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return '';

  // Google Docs wraps everything in a <b style="font-weight:normal" id="docs-internal-guid-…">.
  for (const wrapper of Array.from(body.querySelectorAll('b, strong'))) {
    const weight = declarations(wrapper).get('font-weight');
    if (weight === 'normal' || weight === '400') unwrap(wrapper);
  }
  rebuildWordLists(body);
  // Numbered Word headings keep a marker span outside any list.
  for (const span of Array.from(body.querySelectorAll('span'))) {
    if (declarations(span).get('mso-list') === 'ignore') span.remove();
  }

  // Word's title styles become headings.
  for (const p of Array.from(body.querySelectorAll('p'))) {
    const cls = p.getAttribute('class') ?? '';
    if (/MsoTitle\b/.test(cls)) rename(p, 'h1');
    else if (/MsoSubtitle\b/.test(cls)) rename(p, 'h2');
  }

  walk(body, (element) => {
    const tag = element.tagName.toLowerCase();
    if (dropped.has(tag) || tag.startsWith('v:')) {
      element.remove();
      return;
    }
    semanticStyles(element);
    cleanElement(element);
    if (tag === 'a' && !element.hasAttribute('href')) {
      unwrap(element);
    } else if ((unwrapped.has(tag) && element.attributes.length === 0) || isNamespaced(tag)) {
      // Wrappers go, unless a data attribute marks them as something (a mention, a colour, a media block).
      unwrap(element);
    } else if (tag === 'h5' || tag === 'h6') {
      rename(element, 'h4');
    } else if (tag === 'p' && isEmptyBlock(element) && element.parentElement === body) {
      element.remove();
    } else if (tag === 'br' && /apple-interchange-newline/i.test(element.getAttribute('class') ?? '')) {
      element.remove();
    }
  });

  // Inline wrappers left empty by the cleanup.
  for (const element of Array.from(body.querySelectorAll('strong, em, b, i, u, s, sup, sub'))) {
    if ((element.textContent ?? '') === '' && !element.querySelector('img, br')) element.remove();
  }
  return body.innerHTML;
}

/**
 * Turns pasted plain text into paragraphs: a blank line starts a new paragraph, and a single line break becomes a
 * hard break. Inside a code block the text stays as it is.
 */
export function plainTextSlice(text: string, schema: Schema, $context: ResolvedPos): Slice {
  const normalized = text.replace(/\r\n?/g, '\n');
  if ($context.parent.type.spec.code) return new Slice(Fragment.from(schema.text(normalized)), 0, 0);
  const paragraphType = schema.nodes.paragraph!;
  const hardBreak = schema.nodes.hardBreak;
  const blocks = normalized
    .split(/\n(?:[ \t]*\n)+/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const content: PmNode[] = [];
      lines.forEach((line, index) => {
        if (index > 0) content.push(hardBreak ? hardBreak.create() : schema.text(' '));
        if (line) content.push(schema.text(line));
      });
      return paragraphType.create(null, content);
    });
  if (blocks.length === 0) return Slice.empty;
  if (blocks.length === 1) return new Slice(blocks[0]!.content, 0, 0);
  return new Slice(Fragment.from(blocks), 1, 1);
}

/** Cleans pasted HTML and splits pasted plain text into paragraphs. */
export const PasteCleanup = Extension.create({
  name: 'postCanvasPaste',

  addProseMirrorPlugins() {
    let cached: Record<string, AttrsSanitizer> | null = null;
    const sanitizers = () => (cached ??= sanitizersFor(this.editor.extensionManager.extensions));
    return [
      new Plugin({
        key: new PluginKey('postCanvasPaste'),
        props: {
          transformPastedHTML: (html) => (/data-pm-slice/i.test(html) ? cleanOwnHTML(html) : cleanPastedHTML(html)),
          clipboardTextParser: (text, $context) => plainTextSlice(text, this.editor.schema, $context),
          transformPasted: (slice) => sanitizeSlice(slice, sanitizers()),
        },
      }),
    ];
  },
});

/**
 * HTML from a ProseMirror clipboard (this editor, or another Tiptap site): the same element and attribute allowlist,
 * but wrappers stay and `data-pm-slice` is kept when its context is sane. Without a sane context the HTML gets the full
 * clean.
 */
export function cleanOwnHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sliced = doc.body.querySelector('[data-pm-slice]');
  const context = sliced?.getAttribute('data-pm-slice') ?? '';
  const match = /^(\d+) (\d+)(?:-\d+)? (.*)$/s.exec(context);
  let sane = false;
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[3]!);
      sane = Array.isArray(parsed) && parsed.length <= maxSliceContext * 2;
    } catch {
      sane = false;
    }
  }
  if (!sane) return cleanPastedHTML(html.replace(/data-pm-slice/gi, 'data-x'));
  walk(doc.body, (element) => {
    const tag = element.tagName.toLowerCase();
    if (dropped.has(tag) || tag.includes(':')) {
      element.remove();
      return;
    }
    // A photo's placeholder lives in its img's style; keep that one declaration, and only a strict data URL.
    const placeholder =
      tag === 'img' && element.closest('[data-pc-image], [data-pc-gallery]') ? placeholderStyle(element) : null;
    cleanElement(element, { keepSlice: element === sliced });
    if (placeholder) element.setAttribute('style', placeholder);
  });
  return doc.body.innerHTML;
}

const placeholderPattern =
  /background-image:\s*url\(\s*["']?(data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]{1,2800})["']?\s*\)/i;

/** The `background-image` placeholder of a photo, rebuilt from a strict base64 JPEG, PNG or WebP data URL, or `null`. */
function placeholderStyle(img: Element): string | null {
  const url = placeholderPattern.exec(img.getAttribute('style') ?? '')?.[1];
  return url ? `background-image: url(${url})` : null;
}

/** Runs every node's and mark's sanitizer over a pasted slice, so nothing skips the schema's rules. */
export function sanitizeSlice(slice: Slice, sanitizers: Record<string, AttrsSanitizer>): Slice {
  const cleanMarks = (marks: readonly Mark[]): Mark[] =>
    marks.flatMap((mark) => {
      const sanitize = sanitizers[mark.type.name];
      if (!sanitize) return [mark];
      const attrs = sanitize({ ...mark.attrs });
      return attrs ? [mark.type.create(known(attrs, mark.type.spec.attrs))] : [];
    });
  const cleanFragment = (fragment: Fragment): Fragment => {
    const nodes: PmNode[] = [];
    fragment.forEach((node) => {
      const sanitize = sanitizers[node.type.name];
      let attrs: Record<string, unknown> | null = node.attrs;
      if (sanitize) attrs = sanitize({ ...node.attrs });
      // Only leaf nodes are dropped, so an open wrapper at the slice's edge is never lost.
      if (!attrs && node.isLeaf) return;
      // A wrapper its sanitizer refused keeps its content but none of its own attributes: the type's defaults instead.
      const merged = attrs ? { ...node.attrs, ...known(attrs, node.type.spec.attrs) } : {};
      nodes.push(
        node.isText
          ? node.mark(cleanMarks(node.marks))
          : node.type.create(merged, cleanFragment(node.content), cleanMarks(node.marks)),
      );
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(cleanFragment(slice.content), slice.openStart, slice.openEnd);
}

/** The attributes a node or mark type declares. */
function known(attrs: Record<string, unknown>, spec: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec ?? {})) if (key in attrs) out[key] = attrs[key];
  return out;
}
