// The read-only React view of a document. No hooks and no "use client", so it renders in React Server Components; the
// interactive parts (the video facades, the carousel) are client components inside the node views.
import type { AnyExtension, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import { createElement, type ReactNode } from 'react';
import type { Features, Locale, ViewMap } from '../core/types';
import type { EmbedRenderMode } from '../embeds/render-spec';
import { embedViews } from '../embeds/view/index';
import { mediaViews } from '../media/view/index';
import { specToReact } from '../media/view/spec-to-react';
import { splitTableRows, tableShellSpec } from '../text/table-html';
import { mergedFor, renderExtensions } from './render-extensions';
import { sanitizeDocument, type DocumentLimits } from './sanitize';

/** A table with its leading header rows in `<thead>`, like `renderToHTML()`. */
function TableView({ node, children }: { node: PMNode; children?: ReactNode }): ReactNode {
  const rows = ([] as ReactNode[]).concat(children ?? []);
  const { head, body } = splitTableRows(node, rows);
  return specToReact(tableShellSpec(node), (tag, props, kids) =>
    tag === 'table'
      ? createElement(
          'table',
          props,
          ...kids,
          head.length > 0 ? createElement('thead', { key: 'head' }, ...head) : null,
          createElement('tbody', { key: 'body' }, ...body),
        )
      : undefined,
  );
}

/** Props of `PostCanvasView`. */
export interface PostCanvasViewProps {
  /** The document. */
  content: JSONContent;
  /** The features the document may use. Default: every feature. */
  features?: Features;
  /**
   * How videos and embeds appear: `facade` (default: click to load, with the interactive views), `iframe` (the player
   * straight away) or `link` (a plain link).
   */
  embeds?: EmbedRenderMode;
  /** Extra classes on the root `.pc-view`. */
  className?: string;
  /** The language of the view's few strings. Default English. */
  locale?: Locale;
  /** Light, dark or the reader's system setting. Default `auto`. */
  theme?: 'light' | 'dark' | 'auto';
  /** Run `sanitizeDocument()` first. Default `true`. */
  sanitize?: boolean;
  /** Size caps for the sanitizer. */
  limits?: Partial<DocumentLimits>;
  /** Your own views by node type. They replace the built-in ones. */
  views?: ViewMap;
  /**
   * Extra schema extensions, for your own nodes and marks. They replace built-in ones with the same name, and the
   * sanitizer uses them too. Pass the same array on every render (a module constant), so the schema is built once.
   */
  extensions?: AnyExtension[];
}

/**
 * Shows a document read-only, with the same look as the editor. Media and embed nodes use their interactive views;
 * everything else renders from the schema's static HTML. It sanitizes by default and works from a Server Component.
 *
 * **Render it on the server.** In a React Server Component the schema, the sanitizer and Tiptap stay on the server, and
 * the browser gets only the small client parts (the click-to-load player and the carousel): about 1.5 KB gzipped on
 * top of React. Rendered in the browser, it carries Tiptap and ProseMirror: about 145 KB gzipped. For pages without
 * React on the server, store the output of `renderToHTML()` when the post is saved instead.
 *
 * @example
 * ```tsx
 * import { PostCanvasView } from 'post-canvas/render';
 * import 'post-canvas/styles.css';
 * export default function Post({ post }) {
 *   return <PostCanvasView content={post.content} />;
 * }
 * ```
 */
export function PostCanvasView({
  content,
  features,
  embeds = 'facade',
  className,
  locale,
  theme = 'auto',
  sanitize = true,
  limits,
  views,
  extensions: extra,
}: PostCanvasViewProps): ReactNode {
  const { extensions: base, t } = renderExtensions(features, embeds, locale);
  const extensions = extra?.length ? mergedFor(base, extra) : base;
  const doc = sanitize
    ? sanitizeDocument(content, { features, limits, ...(extra?.length ? { extensions } : {}) }).doc
    : content;
  const map: ViewMap = { ...mediaViews, ...(embeds === 'facade' ? embedViews : {}), ...views };
  const nodeMapping = Object.fromEntries(
    Object.entries(map).flatMap(([type, View]) =>
      View
        ? [
            [
              type,
              ({ node }: { node: { attrs: Record<string, unknown> } }) => (
                <View node={{ type, attrs: node.attrs }} t={t} />
              ),
            ],
          ]
        : [],
    ),
  );
  // Your own `table` view or extension keeps its own rendering.
  const ownTable = Boolean(views?.table) || Boolean(extra?.some((extension) => extension.name === 'table'));
  const body = renderToReactElement({
    content: doc,
    extensions,
    options: { nodeMapping: ownTable ? nodeMapping : { table: TableView, ...nodeMapping } },
  });
  return (
    <div className={className ? `pc-view ${className}` : 'pc-view'} data-pc-theme={theme}>
      <div className="pc-content">{body}</div>
    </div>
  );
}
