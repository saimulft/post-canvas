// The render-safe text schema: node and mark names, attributes, parseHTML, renderHTML and sanitizers. No React, no DOM
// access at import time and no node views, so it runs on the server. `text/kit.ts` extends these for the editor.
import {
  createInlineMarkdownSpec,
  Mark,
  mergeAttributes,
  Node,
  type AnyExtension,
  type Attributes,
  type MarkConfig,
  type NodeConfig,
} from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Highlight, { type HighlightOptions } from '@tiptap/extension-highlight';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Italic from '@tiptap/extension-italic';
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Text from '@tiptap/extension-text';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { safeHref } from '../core/url';
import type { Features } from '../core/types';
import {
  codeLanguage,
  headingId,
  htmlLinkTarget,
  linkRel,
  paletteColor,
  sanitizeCodeBlock,
  sanitizeHeading,
  sanitizeHighlight,
  sanitizeLink,
  sanitizeMention,
  sanitizeOrderedList,
  sanitizeParagraph,
  sanitizeTableCell,
  sanitizeTableHeader,
  sanitizeTaskItem,
  sanitizeTextStyle,
  tableScope,
} from './sanitize';
import '../core/extension-fields';

/** `paragraph`, with its sanitizer. */
export const PcParagraph = Paragraph.extend({ postCanvasSanitize: sanitizeParagraph });

/**
 * `heading`, levels 1 to 4, with an optional `id` for anchor links (`#pricing`). The id is kept from imported HTML and
 * isn't copied when a heading is split; `sanitizeDocument()` keeps only the first of duplicate ids.
 */
export const PcHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => headingId(element.getAttribute('id')),
        renderHTML: (attrs: { id?: unknown }) => {
          const id = headingId(attrs.id);
          return id ? { id } : {};
        },
      },
    };
  },
  postCanvasSanitize: sanitizeHeading,
});

/**
 * `code`, which can sit inside a link, bold or other marks (`[\`npm i\`](…)`): Tiptap's own code mark excludes every
 * other mark, so links around code were lost on import.
 */
export const PcCode = Code.extend({ excludes: '' });

/** Wraps an attribute's parseHTML so the parsed value goes through a sanitizer. */
function cleanedOnParse(
  parent: Attributes | object | undefined,
  sanitize: (attrs: Record<string, unknown>) => Record<string, unknown> | null,
  names: string[],
): Attributes {
  const out: Attributes = { ...(parent as Attributes | undefined) };
  for (const name of names) {
    const spec = out[name] ?? {};
    out[name] = {
      ...spec,
      parseHTML: (element: HTMLElement) => {
        const raw: unknown = spec.parseHTML ? spec.parseHTML(element) : element.getAttribute(name);
        return sanitize({ [name]: raw })?.[name] ?? null;
      },
    };
  }
  return out;
}

/** `orderedList`, with a sanitized `start` and `type`, also when parsed from HTML. */
export const PcOrderedList = OrderedList.extend({
  addAttributes() {
    return cleanedOnParse(this.parent?.(), sanitizeOrderedList, ['start', 'type']);
  },
  postCanvasSanitize: sanitizeOrderedList,
});

/** `taskItem`, with a boolean `checked`. Items can nest. */
export const PcTaskItem = TaskItem.extend({ postCanvasSanitize: sanitizeTaskItem }).configure({ nested: true });

// Spans are clamped as they're parsed, so a pasted colspan="100000" can't make a table of millions of cells.
const clampSpan = (attrs: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const n = Number(value);
    out[key] = Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 1;
  }
  return out;
};

/** `tableCell`, with sanitized spans and widths. */
export const PcTableCell = TableCell.extend({
  addAttributes() {
    return cleanedOnParse(this.parent?.(), clampSpan, ['colspan', 'rowspan']);
  },
  postCanvasSanitize: sanitizeTableCell,
});

/** `tableHeader`, with sanitized spans and widths, and the `scope` it had (`col`, `row`, `colgroup` or `rowgroup`). */
export const PcTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...cleanedOnParse(this.parent?.(), clampSpan, ['colspan', 'rowspan']),
      scope: {
        default: null,
        parseHTML: (element: HTMLElement) => tableScope(element.getAttribute('scope')),
        renderHTML: (attrs: { scope?: unknown }) => {
          const scope = tableScope(attrs.scope);
          return scope ? { scope } : {};
        },
      },
    };
  },
  postCanvasSanitize: sanitizeTableHeader,
});

/** `codeBlock`: the language comes from `class="language-…"` and must match the language pattern. */
export const PcCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const named = (from: Element | null) =>
            Array.from(from?.classList ?? [])
              .find((name) => name.startsWith('language-'))
              ?.slice('language-'.length);
          return codeLanguage(
            named(element.querySelector('code')) ?? named(element) ?? element.getAttribute('data-language'),
          );
        },
        rendered: false,
      },
    };
  },
  postCanvasSanitize: sanitizeCodeBlock,
});

/**
 * The parts of `link` the schema and the editor share: attributes, parse and render rules, Markdown and the sanitizer.
 * The schema version is a plain mark, so render bundles don't carry the editor's autolinking (linkifyjs); the kit
 * extends Tiptap's `Link` with the same parts.
 */
export const linkSpec = {
  addAttributes() {
    return {
      href: { default: null, parseHTML: (element: HTMLElement) => safeHref(element.getAttribute('href')) },
      target: {
        default: null,
        parseHTML: (element: HTMLElement) => htmlLinkTarget(element.getAttribute('target')),
      },
      rel: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          linkRel(element.getAttribute('rel'), htmlLinkTarget(element.getAttribute('target'))),
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'a[href]', getAttrs: (element: HTMLElement) => (safeHref(element.getAttribute('href')) ? null : false) },
    ];
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    // An unsafe href (from unsanitized JSON or a raw setMark) renders as plain text in an anchor without a link.
    const href = safeHref(HTMLAttributes.href);
    if (!href) return ['a', {}, 0];
    const target = HTMLAttributes.target === '_blank' ? '_blank' : null;
    return ['a', { href, target, rel: linkRel(HTMLAttributes.rel, target) }, 0];
  },
  markdownTokenName: 'link',
  parseMarkdown: (token, helpers) =>
    helpers.applyMark('link', helpers.parseInline(token.tokens || []), { href: safeHref(token.href) }),
  renderMarkdown: (node, h) => `[${h.renderChildren(node)}](${String(node.attrs?.href ?? '')})`,
  postCanvasSanitize: sanitizeLink,
} satisfies Partial<MarkConfig>;

/**
 * `link`: `href` must pass `safeHref`, `target` is `_blank` or nothing, and `rel` always carries `noopener` with
 * `_blank`. Nothing is clickable in the editor.
 */
export const PcLink = Mark.create({
  name: 'link',
  priority: 1000,
  keepOnSplit: false,
  exitable: true,
  inclusive: false,
  ...linkSpec,
});

/** `textStyle`, carrying a palette colour by name. */
export const PcTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      {
        tag: 'span[data-color]',
        getAttrs: (element: HTMLElement) => (paletteColor(element.getAttribute('data-color')) ? {} : false),
      },
    ];
  },
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => paletteColor(element.getAttribute('data-color')),
        renderHTML: (attrs: { color?: unknown }) => {
          const color = paletteColor(attrs.color);
          return color ? { 'data-color': color, class: `pc-color-${color}` } : {};
        },
      },
    };
  },
  postCanvasSanitize: sanitizeTextStyle,
});

/** `highlight`, in a palette colour or the default. */
export const PcHighlight = Highlight.extend({
  addOptions() {
    return { ...(this.parent?.() as HighlightOptions), multicolor: true, HTMLAttributes: {} };
  },
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => paletteColor(element.getAttribute('data-color')),
        renderHTML: (attrs: { color?: unknown }) => {
          const color = paletteColor(attrs.color);
          return color ? { 'data-color': color, class: `pc-highlight-${color}` } : {};
        },
      },
    };
  },
  postCanvasSanitize: sanitizeHighlight,
});

/** The text a mention shows: `@Ada Lovelace` or `#design`. */
export function mentionText(attrs: Record<string, unknown>): string {
  const char = attrs.mentionSuggestionChar === '#' ? '#' : '@';
  const id = typeof attrs.id === 'string' || typeof attrs.id === 'number' ? String(attrs.id) : '';
  const label = typeof attrs.label === 'string' && attrs.label ? attrs.label : id;
  return `${char}${label}`;
}

/** The attribute of a mention that Tiptap's `Mention` stores, read from and written to `data-*`. */
function mentionAttribute(name: string, fallback: string | null, always = false) {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`),
    renderHTML: (attributes: Record<string, unknown>) =>
      always || attributes[camel(name)] ? { [`data-${name}`]: attributes[camel(name)] } : {},
  };
}

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** The HTML of a mention: a span with its data, its class and its text. */
function mentionHTML(HTMLAttributes: Record<string, unknown>, attrs: Record<string, unknown>) {
  return [
    'span',
    mergeAttributes({ 'data-type': 'mention' }, HTMLAttributes, {
      class: attrs.mentionSuggestionChar === '#' ? 'pc-hashtag' : 'pc-mention',
    }),
    mentionText(attrs),
  ] as const;
}

/**
 * The parts of `mention` the schema and the editor share. The schema version is a plain node, so render bundles don't
 * carry the suggestion plugin; the kit extends Tiptap's `Mention` with the same attributes and output.
 */
export const mentionSpec = {
  addAttributes() {
    return {
      id: mentionAttribute('id', null),
      label: mentionAttribute('label', null),
      mentionSuggestionChar: mentionAttribute('mention-suggestion-char', '@', true),
    };
  },
  ...createInlineMarkdownSpec({
    nodeName: 'mention',
    name: '@',
    selfClosing: true,
    allowedAttributes: ['id', 'label', { name: 'mentionSuggestionChar', skipIfDefault: '@' }],
    // As Tiptap's `Mention` writes them: `char="#"` stands for `mentionSuggestionChar`.
    parseAttributes: (attrString: string) => {
      const attrs: Record<string, string> = {};
      for (const match of attrString.matchAll(/(?:^|\s)(\w+)=(?:"([^"]*)"|'([^']*)')/g)) {
        const [, key = '', doubleQuoted, singleQuoted] = match;
        attrs[key === 'char' ? 'mentionSuggestionChar' : key] = doubleQuoted ?? singleQuoted ?? '';
      }
      return attrs;
    },
    serializeAttributes: (attrs: Record<string, unknown>) =>
      Object.entries(attrs)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key === 'mentionSuggestionChar' ? 'char' : key}="${String(value)}"`)
        .join(' '),
  }),
  postCanvasSanitize: sanitizeMention,
} satisfies Partial<NodeConfig>;

/** `mention`: people with `@` and hashtags with `#`. The schema version never opens a suggestion list. */
export const PcMention = Node.create({
  name: 'mention',
  priority: 101,
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,
  ...mentionSpec,
  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return mentionHTML(HTMLAttributes, node.attrs);
  },
  renderText({ node }) {
    return mentionText(node.attrs);
  },
});

/** The mention's HTML, for the kit's `Mention` configuration. */
export { mentionHTML };

/** Options shared by the schema and the editor kit. */
export interface TextExtensionParts {
  link: AnyExtension;
  table: AnyExtension;
  mention: AnyExtension;
  codeBlock: AnyExtension;
}

/**
 * Every text extension for a feature set, in schema order. `parts` swaps in editor versions of the few extensions that
 * differ (the kit passes autolinking links, resizable tables, suggesting mentions and highlighted code).
 */
export function textExtensions(features: Features, parts?: Partial<TextExtensionParts>): AnyExtension[] {
  const list: AnyExtension[] = [Document, Text, PcParagraph, HardBreak];
  if (features.heading) list.push(PcHeading.configure({ levels: features.heading.levels }));
  if (features.bold) list.push(Bold);
  if (features.italic) list.push(Italic);
  if (features.underline) list.push(Underline);
  if (features.strike) list.push(Strike);
  if (features.code) list.push(PcCode);
  if (features.subscript) list.push(Subscript);
  if (features.superscript) list.push(Superscript);
  if (features.link) list.push(parts?.link ?? PcLink);
  if (features.color) list.push(PcTextStyle);
  if (features.highlight) list.push(PcHighlight);
  if (features.textAlign) {
    list.push(
      TextAlign.configure({
        types: features.heading ? ['heading', 'paragraph'] : ['paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: null,
      }),
    );
  }
  if (features.blockquote) list.push(Blockquote);
  if (features.horizontalRule) list.push(HorizontalRule);
  if (features.bulletList || features.orderedList) list.push(ListItem);
  if (features.bulletList) list.push(BulletList);
  if (features.orderedList) list.push(PcOrderedList);
  if (features.taskList) list.push(TaskList, PcTaskItem);
  if (features.codeBlock) list.push(parts?.codeBlock ?? PcCodeBlock);
  if (features.table) {
    list.push(parts?.table ?? Table.configure({ resizable: false }), TableRow, PcTableHeader, PcTableCell);
  }
  if (features.mention || features.hashtag) list.push(parts?.mention ?? PcMention);
  return list;
}

/** The render-safe text extensions for a feature set. */
export function textSchema(features: Features): AnyExtension[] {
  return textExtensions(features);
}
