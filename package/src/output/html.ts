// Server-safe HTML output: Tiptap JSON to an HTML string through `@tiptap/static-renderer`, with no DOM. Text and
// attribute values are escaped by the renderer, and every embed URL is rebuilt from validated ids.
import type { AnyExtension, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { domOutputSpecToHTMLString, renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import type { Features, Locale } from '../core/types';
import type { EmbedRenderMode } from '../embeds/render-spec';
import { splitTableRows, tableShellSpec } from '../text/table-html';
import { mergedFor, renderExtensions } from './render-extensions';
import { sanitizeDocument, type DocumentLimits } from './sanitize';

/** A table with its leading header rows in `<thead>`. */
function tableToHTML({ node, children }: { node: PMNode; children?: unknown }): string {
  const rows = ([] as unknown[]).concat(children ?? []).map((row) => (typeof row === 'string' ? row : ''));
  const { head, body } = splitTableRows(node, rows);
  const shell = domOutputSpecToHTMLString(tableShellSpec(node))();
  const inner = `${head.length ? `<thead>${head.join('')}</thead>` : ''}<tbody>${body.join('')}</tbody>`;
  return shell.replace(/<\/table>$/, `${inner}</table>`);
}

/** Options of `renderToHTML()`. */
export interface RenderHTMLOptions {
  /** The features the document may use. Default: every feature. */
  features?: Features;
  /**
   * Run `sanitizeDocument()` first. Default `true`. Turn it off only for a document you sanitized yourself when it was
   * saved.
   */
  sanitize?: boolean;
  /** How videos and embeds appear: `facade` (default, click to load), `iframe` or `link`. */
  embeds?: EmbedRenderMode;
  /** Wrap the output in `<div class="pc-view" data-pc-theme="…"><div class="pc-content">`. Default `true`. */
  wrapper?: boolean;
  /**
   * The wrapper's `data-pc-theme`: light, dark, or the reader's system setting. Default `auto`, as in
   * `PostCanvasView`. Without the wrapper, put `data-pc-theme` on your own element.
   */
  theme?: 'light' | 'dark' | 'auto';
  /** The language of the few strings the output contains, such as "Watch on YouTube". Default English. */
  locale?: Locale;
  /** Size caps for the sanitizer. */
  limits?: Partial<DocumentLimits>;
  /** Extra schema extensions, for your own nodes. They replace built-in ones with the same name. */
  extensions?: AnyExtension[];
}

/**
 * Renders a document to an HTML string, on the server or in the browser, with no DOM.
 *
 * **Run it on the server or when the post is saved**, and send readers the HTML. It needs Tiptap and ProseMirror, so
 * calling it in the browser adds about 140 KB gzipped to the page.
 *
 * By default it sanitizes the document first, wraps the result in `.pc-view > .pc-content` (style it with
 * `post-canvas/styles.css`), and shows videos and embeds as click-to-load facades: call `activateEmbeds()` from
 * `post-canvas/render` (or `post-canvas/vanilla`, or the CDN global) on the page to turn a click into the player, or
 * use `embeds: 'iframe'`.
 *
 * @example
 * ```ts
 * import { renderToHTML } from 'post-canvas/render';
 * const html = renderToHTML(post.content);
 * ```
 */
export function renderToHTML(json: JSONContent, options: RenderHTMLOptions = {}): string {
  const { features, sanitize = true, embeds = 'facade', wrapper = true, theme = 'auto', locale, limits } = options;
  const base = renderExtensions(features, embeds, locale).extensions;
  const extensions = options.extensions?.length ? mergedFor(base, options.extensions) : base;
  const content = sanitize
    ? sanitizeDocument(json, { features, limits, ...(options.extensions?.length ? { extensions } : {}) }).doc
    : json;
  // Your own `table` extension keeps its own rendering.
  const ownTable = options.extensions?.some((extension) => extension.name === 'table');
  const html = renderToHTMLString({
    content,
    extensions,
    ...(ownTable ? {} : { options: { nodeMapping: { table: tableToHTML } } }),
  });
  const themeName = theme === 'light' || theme === 'dark' ? theme : 'auto';
  return wrapper
    ? `<div class="pc-view" data-pc-theme="${themeName}"><div class="pc-content">${html}</div></div>`
    : html;
}
