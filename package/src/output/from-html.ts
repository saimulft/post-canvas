// HTML in: any HTML (from TinyMCE, Froala, CKEditor, Word or our own output) parsed through the schema's parse rules,
// then sanitized. It needs an HTML parser: the browser's own, or a server-side window such as happy-dom's.
import type { JSONContent } from '@tiptap/core';
import { DOMParser as SchemaParser } from '@tiptap/pm/model';
import type { Features } from '../core/types';
import { resolveMediaSrc, safeMediaSrc } from '../core/url';
import { cleanSrcset } from '../media/sanitize';
import { maxRemovals, sanitizeDocument, sanitizerSetup, type DocumentLimits, type SanitizeRemoval } from './sanitize';

/**
 * Anything that can parse an HTML string into a document: a browser `window`, or a happy-dom or linkedom window. The
 * parsed document is typed loosely, so DOM libraries whose `Document` type differs from the DOM lib's still fit.
 */
export interface HTMLParserHost {
  DOMParser: new () => { parseFromString(html: string, type: 'text/html'): unknown };
}

/** Options of `fromHTML()`. */
export interface FromHTMLOptions {
  features?: Features;
  limits?: Partial<DocumentLimits>;
  /**
   * The parser to use. Defaults to the global `DOMParser`, which browsers have. On a server, pass a window from a DOM
   * library, for example `new (await import('happy-dom')).Window()`.
   */
  window?: HTMLParserHost;
  /**
   * Receives everything the import left out: elements removed before parsing (scripts, styles, embedded objects),
   * pictures and frames the schema refused (relative or `data:` sources, players from unknown sites), and what
   * `sanitizeDocument()` removed afterwards. Formatting the schema has no place for, such as fonts, sizes and colours
   * outside the palette, is dropped without a record. At most 100 items are listed; `omitted` counts the rest.
   */
  onRemoved?: (removed: SanitizeRemoval[], omitted: number) => void;
  /**
   * The longest HTML string accepted, in characters. Default 1,000,000. Longer input, or input nested deeper than 512
   * elements, throws a `RangeError` before anything is parsed, so a hostile import can't stall or crash the server.
   */
  maxLength?: number;
  /**
   * An absolute http(s) URL that relative picture addresses resolve against, for HTML written for one site: with
   * `https://example.com`, `<img src="/images/a.jpg">` is kept as `https://example.com/images/a.jpg`. Without it,
   * relative pictures are dropped (and listed in `onRemoved`), because a document only stores absolute sources.
   */
  baseUrl?: string;
}

/** Elements whose end tag may be left out, and elements that never have one: neither counts toward nesting. */
const unnested = new Set(
  'p li dt dd option optgroup tr td th tbody thead tfoot colgroup rp rt area base br col embed hr img input link meta source track wbr'.split(
    ' ',
  ),
);
/** Browsers stop nesting near this depth; deeper input is only ever an attack. */
const maxNesting = 512;

/** How deeply the HTML nests its elements, counted from the tags alone, without parsing it. Stops past `limit`. */
function nestingOf(html: string, limit: number): number {
  let depth = 0;
  let deepest = 0;
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)[^>]*?(\/?)>/gi)) {
    const tag = (match[2] ?? '').toLowerCase();
    if (unnested.has(tag) || match[3]) continue;
    depth = match[1] ? Math.max(0, depth - 1) : depth + 1;
    if (depth > deepest && (deepest = depth) > limit) break;
  }
  return deepest;
}

/** Gives relative picture sources and `srcset` entries absolute addresses, against `baseUrl`. */
function resolveRelativePictures(document: Document, baseUrl: string): void {
  for (const img of Array.from(document.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (src && !safeMediaSrc(src)) {
      const resolved = resolveMediaSrc(src, baseUrl);
      if (resolved) img.setAttribute('src', resolved);
    }
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const cleaned = cleanSrcset(srcset, baseUrl);
      if (cleaned) img.setAttribute('srcset', cleaned);
      else img.removeAttribute('srcset');
    }
  }
}

/** Elements removed before parsing: they never carry content, and some would run or load something. */
const strippedTags = 'script, style, template, noscript, object, embed, link, meta';
/** Elements that become a node only when a parse rule accepts them; anything else would vanish without a trace. */
const checkedTags = 'img, iframe';
/** At most this many elements are test-parsed one by one, so a huge import stays cheap. */
const maxChecked = 500;

function parserHost(options: FromHTMLOptions): HTMLParserHost {
  if (options.window) return options.window;
  const global = globalThis as { DOMParser?: HTMLParserHost['DOMParser'] };
  if (global.DOMParser) return { DOMParser: global.DOMParser };
  throw new Error(
    "[post-canvas] fromHTML() needs an HTML parser here. Pass { window } from a DOM library, e.g. new (await import('happy-dom')).Window().",
  );
}

/**
 * Reads HTML into a sanitized document. Scripts never run: the HTML is parsed into an inert document, read through the
 * schema's parse rules, and then cleaned by `sanitizeDocument()`. HTML from editors such as TinyMCE and Froala keeps
 * its headings, lists, tables, links and formatting, and their YouTube, Vimeo and other player iframes become video
 * and embed nodes.
 *
 * On a server, wrap the call in `try`/`catch`: input over `maxLength`, or nested absurdly deep, throws a `RangeError`.
 */
export function fromHTML(html: string, options: FromHTMLOptions = {}): JSONContent {
  const maxLength = options.maxLength ?? 1_000_000;
  if (html.length > maxLength) {
    throw new RangeError(`[post-canvas] fromHTML() got ${html.length} characters; the limit is ${maxLength}.`);
  }
  if (nestingOf(html, maxNesting) > maxNesting) {
    throw new RangeError(`[post-canvas] fromHTML() got HTML nested deeper than ${maxNesting} elements.`);
  }
  const host = parserHost(options);
  const { schema } = sanitizerSetup({ features: options.features });
  const document = new host.DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  ) as Document;
  const removed: SanitizeRemoval[] = [];
  let omitted = 0;
  const record = (tag: string, index: number) => {
    if (removed.length < maxRemovals) removed.push({ path: `html:${tag}[${index}]`, reason: 'rejected', type: tag });
    else omitted++;
  };
  Array.from(document.querySelectorAll(strippedTags)).forEach((element, index) => {
    const tag = element.tagName.toLowerCase();
    // `link` and `meta` are page metadata, not content, so leaving them out isn't worth a record.
    if (tag !== 'link' && tag !== 'meta') record(tag, index);
    element.remove();
  });
  // Paste cleanup turns h5 and h6 into h4, the deepest heading the schema has; imports do the same.
  for (const deep of Array.from(document.querySelectorAll('h5, h6'))) {
    const heading = document.createElement('h4');
    for (const attribute of Array.from(deep.attributes)) heading.setAttribute(attribute.name, attribute.value);
    heading.append(...Array.from(deep.childNodes));
    deep.replaceWith(heading);
  }
  if (options.baseUrl) resolveRelativePictures(document, options.baseUrl);
  const parser = SchemaParser.fromSchema(schema);
  // A picture or frame the schema refuses leaves no node behind: parse each on its own to find and list those.
  Array.from(document.querySelectorAll(checkedTags))
    .slice(0, maxChecked)
    .forEach((element, index) => {
      const probe = document.createElement('div');
      probe.append(element.cloneNode(true));
      let kept = false;
      parser.parse(probe).descendants((node) => {
        if (node.isAtom && !node.isText) kept = true;
        return !kept;
      });
      if (!kept) {
        record(element.tagName.toLowerCase(), index);
        element.remove();
      }
    });
  const parsed = parser.parse(document.body).toJSON() as JSONContent;
  const result = sanitizeDocument(parsed, { features: options.features, limits: options.limits });
  if (options.onRemoved) {
    const room = maxRemovals - removed.length;
    options.onRemoved(
      [...removed, ...result.removed.slice(0, Math.max(0, room))],
      omitted + result.omitted + Math.max(0, result.removed.length - room),
    );
  }
  return result.doc;
}
