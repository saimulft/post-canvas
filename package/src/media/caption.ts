// Formatted captions: text with links, bold, italic, underline, strike and code, and line breaks. Stored as a small
// inline JSON list on the image (`captionContent`), next to its plain text (`caption`). Render-safe and pure: the
// sanitizer, the HTML output and the parse rules all use these, on the server too.
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { safeHref } from '../core/url';
import { captionMarks, type CaptionContent, type CaptionMark, type CaptionNode, type Features } from '../core/types';
import { linkRel } from '../text/sanitize';
import { textLimits } from './rules';

type Attrs = Record<string, unknown>;

/** A child in a `DOMOutputSpec`: an element spec or text. */
export type SpecChild = DOMOutputSpec | string;
type Mark = NonNullable<CaptionNode['marks']>[number];

/** The most pieces a caption keeps, so a hostile document can't make one huge. */
const maxNodes = 400;
/** The most line breaks a caption keeps. */
const maxBreaks = 20;

// C0 controls (newlines and tabs too: a caption's line breaks are `hardBreak` pieces), DEL, the line and paragraph
// separators, and the bidirectional controls.
// eslint-disable-next-line no-control-regex
const unwanted = /[\u0000-\u001f\u007f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const record = (value: unknown): Attrs =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Attrs) : {};

/** The caption marks a feature set allows. */
export function captionMarksFor(features: Pick<Features, CaptionMark>): CaptionMark[] {
  return captionMarks.filter((mark) => features[mark]);
}

/** A caption link mark's attributes, or `null` when its href isn't safe. */
function linkAttrs(attrs: unknown): { href: string; target: '_blank' | null; rel: string | null } | null {
  const raw = record(attrs);
  const href = safeHref(raw.href);
  if (!href) return null;
  const target = raw.target === '_blank' ? '_blank' : null;
  return { href, target, rel: linkRel(raw.rel, target) };
}

const markKey = (mark: Mark) => (mark.type === 'link' ? `link:${JSON.stringify(mark.attrs ?? {})}` : mark.type);

/** Known marks only, each once, links with safe attributes, in nesting order. */
function cleanMarks(raw: unknown, allowed: readonly CaptionMark[]): Mark[] {
  if (!Array.isArray(raw)) return [];
  const found = new Map<CaptionMark, Mark>();
  for (const item of raw.slice(0, 12)) {
    const mark = record(item);
    const type = mark.type as CaptionMark;
    if (!allowed.includes(type) || found.has(type)) continue;
    if (type === 'link') {
      const attrs = linkAttrs(mark.attrs);
      if (attrs) found.set(type, { type, attrs });
    } else {
      found.set(type, { type });
    }
  }
  return captionMarks.filter((type) => found.has(type)).map((type) => found.get(type) as Mark);
}

const sameMarks = (a: readonly Mark[] = [], b: readonly Mark[] = []) =>
  a.length === b.length && a.every((mark, index) => markKey(mark) === markKey(b[index] as Mark));

/**
 * A formatted caption from untrusted JSON: text and line-break pieces only, allowed marks only, safe links, at most
 * 1,000 characters and 20 line breaks, neighbouring pieces with the same marks joined, and no line breaks at the ends.
 * An empty list when nothing is left. A plain string becomes one text piece.
 */
export function sanitizeCaptionContent(
  value: unknown,
  allowed: readonly CaptionMark[] = captionMarks,
): CaptionContent {
  const input: unknown[] = typeof value === 'string' ? fromPlainText(value) : Array.isArray(value) ? value : [];
  const out: CaptionNode[] = [];
  let length = 0;
  let breaks = 0;
  for (const item of input.slice(0, maxNodes)) {
    const node = record(item);
    if (node.type === 'hardBreak') {
      if (breaks >= maxBreaks || out.length === 0 || out[out.length - 1]?.type === 'hardBreak') continue;
      breaks++;
      out.push({ type: 'hardBreak' });
      continue;
    }
    if (node.type !== 'text' || typeof node.text !== 'string') continue;
    const room = textLimits.caption - length;
    if (room <= 0) break;
    let text = node.text.slice(0, room * 4).replace(unwanted, ' ');
    text = Array.from(text).slice(0, room).join('');
    if (!text) continue;
    length += text.length;
    const marks = cleanMarks(node.marks, allowed);
    const last = out[out.length - 1];
    if (last?.type === 'text' && sameMarks(last.marks, marks)) {
      last.text = `${last.text ?? ''}${text}`;
    } else {
      out.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
    }
  }
  while (out[out.length - 1]?.type === 'hardBreak') out.pop();
  // Spaces at the very ends would only show as a gap; spaces inside the caption are kept.
  const first = out[0];
  if (first?.type === 'text') first.text = (first.text ?? '').replace(/^\s+/, '');
  const end = out[out.length - 1];
  if (end?.type === 'text') end.text = (end.text ?? '').replace(/\s+$/, '');
  return out.filter((node) => node.type === 'hardBreak' || node.text);
}

/** Plain caption text as pieces: each newline becomes a line break. */
function fromPlainText(text: string): CaptionNode[] {
  const out: CaptionNode[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      if (index > 0) out.push({ type: 'hardBreak' });
      if (line) out.push({ type: 'text', text: line });
    });
  return out;
}

/** The caption's plain text: line breaks become newlines. */
export function captionText(content: readonly CaptionNode[]): string {
  return content.map((node) => (node.type === 'hardBreak' ? '\n' : (node.text ?? ''))).join('');
}

/** True when the caption has marks or line breaks, so its plain text alone would lose something. */
export function isFormattedCaption(content: readonly CaptionNode[]): boolean {
  return content.some((node) => node.type === 'hardBreak' || (node.marks?.length ?? 0) > 0);
}

/**
 * The caption fields of an image from either kind of value: `captionContent` (formatted pieces) wins when it has any;
 * otherwise the plain `caption`. Both come back cleaned and in step: `captionContent` is `null` for a caption without
 * formatting.
 */
export function captionFields(
  caption: unknown,
  captionContent: unknown,
  allowed: readonly CaptionMark[] = captionMarks,
): { caption: string; captionContent: CaptionContent | null } {
  const rich = Array.isArray(captionContent) ? sanitizeCaptionContent(captionContent, allowed) : [];
  const content = rich.length > 0 ? rich : sanitizeCaptionContent(typeof caption === 'string' ? caption : '', allowed);
  return { caption: captionText(content), captionContent: isFormattedCaption(content) ? content : null };
}

const markTags: Record<Exclude<CaptionMark, 'link'>, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
};

/** A line break in the tree below: an object, so a caption reading "br" stays text. */
const lineBreak = Object.freeze({ lineBreak: true as const });

interface Branch {
  mark: Mark | null;
  children: Array<Branch | string | typeof lineBreak>;
}

/**
 * The caption's children as `DOMOutputSpec`s, for a `figcaption`. Marks nest in a fixed order (a link outermost), and
 * a mark that spans several pieces opens once, so `<a>Photo <em>via</em> us</a>` stays one link.
 */
export function captionChildrenSpec(content: readonly CaptionNode[]): SpecChild[] {
  const root: Branch = { mark: null, children: [] };
  const stack: Branch[] = [root];
  for (const node of content) {
    // In nesting order even for unsanitized input, so a link always sits outermost.
    const marks =
      node.type === 'text'
        ? [...(node.marks ?? [])].sort((a, b) => captionMarks.indexOf(a.type) - captionMarks.indexOf(b.type))
        : [];
    let common = 0;
    while (
      common < stack.length - 1 &&
      common < marks.length &&
      markKey(stack[common + 1]?.mark as Mark) === markKey(marks[common] as Mark)
    ) {
      common++;
    }
    stack.length = common + 1;
    for (const mark of marks.slice(common)) {
      const branch: Branch = { mark, children: [] };
      stack[stack.length - 1]?.children.push(branch);
      stack.push(branch);
    }
    stack[stack.length - 1]?.children.push(node.type === 'hardBreak' ? lineBreak : (node.text ?? ''));
  }
  return root.children.map(toSpec);
}

function element(tag: string, attrs: Record<string, string>, children: SpecChild[]): DOMOutputSpec {
  return [tag, attrs, ...children] as DOMOutputSpec;
}

function toSpec(child: Branch | string | typeof lineBreak): SpecChild {
  if (child === lineBreak) return ['br'];
  if (typeof child === 'string') return child;
  if (!('children' in child)) return '';
  const kids = child.children.map(toSpec);
  const mark = child.mark;
  if (!mark) return element('span', {}, kids);
  if (mark.type === 'link') {
    const attrs = linkAttrs(mark.attrs);
    if (!attrs) return element('span', {}, kids);
    const out: Record<string, string> = { href: attrs.href };
    if (attrs.target) out.target = attrs.target;
    if (attrs.rel) out.rel = attrs.rel;
    return element('a', out, kids);
  }
  return element(markTags[mark.type] ?? 'span', {}, kids);
}

const blockTags = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TABLE', 'TR']);
const tagMarks: Record<string, CaptionMark> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italic',
  I: 'italic',
  U: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  CODE: 'code',
};

/**
 * A formatted caption read from an element such as a `figcaption`: its text with links and the marks above, `<br>`
 * and block boundaries as line breaks, and runs of whitespace collapsed as a browser would show them. Then cleaned with
 * `sanitizeCaptionContent`.
 */
export function captionFromElement(element: Element, allowed: readonly CaptionMark[] = captionMarks): CaptionContent {
  const out: CaptionNode[] = [];
  const visit = (node: Node, marks: Mark[]) => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (text) out.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      out.push({ type: 'hardBreak' });
      return;
    }
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return;
    let next = marks;
    const markType = tagMarks[tag];
    if (markType) next = [...marks, { type: markType }];
    else if (tag === 'A') {
      const attrs = linkAttrs({
        href: el.getAttribute('href'),
        target: el.getAttribute('target'),
        rel: el.getAttribute('rel'),
      });
      if (attrs) next = [...marks, { type: 'link', attrs }];
    }
    const block = blockTags.has(tag);
    if (block && out.length > 0) out.push({ type: 'hardBreak' });
    el.childNodes.forEach((child) => visit(child, next));
    if (block) out.push({ type: 'hardBreak' });
  };
  element.childNodes.forEach((child) => visit(child, []));
  // Spaces next to a line break are only layout.
  for (let index = 0; index < out.length; index++) {
    const node = out[index];
    if (node?.type !== 'text') continue;
    if (out[index - 1]?.type === 'hardBreak') node.text = (node.text ?? '').replace(/^ +/, '');
    if (out[index + 1]?.type === 'hardBreak') node.text = (node.text ?? '').replace(/ +$/, '');
  }
  return sanitizeCaptionContent(out, allowed);
}
