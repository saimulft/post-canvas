// Attribute sanitizers for every text node and mark that has attributes. Pure: they run on the server, on JSON from
// clients, and inside parseHTML. Each one only touches the keys it's given, so it works for any feature set.
import { safeHref } from '../core/url';
import { paletteColors, type PaletteColor, type TextAlign } from '../core/types';

type Attrs = Record<string, unknown>;

/** Code block languages: lower-case letters, digits, `+`, `#` and `-`, 1 to 20 characters. */
export const codeLanguagePattern = /^[a-z0-9+#-]{1,20}$/;

/** The `rel` a link with `target="_blank"` gets by default. */
export const defaultBlankRel = 'noopener noreferrer nofollow';

const alignments: readonly Exclude<TextAlign, null>[] = ['left', 'center', 'right', 'justify'];
const relTokens = new Set(['noopener', 'noreferrer', 'nofollow', 'ugc', 'sponsored', 'external']);
const listTypes = new Set(['1', 'a', 'A', 'i', 'I']);
const maxSpan = 100;
const maxColumnWidth = 4000;

/** A palette colour name, or `null` for anything else (hex values, CSS, injection attempts). */
export function paletteColor(value: unknown): PaletteColor | null {
  return typeof value === 'string' && (paletteColors as readonly string[]).includes(value)
    ? (value as PaletteColor)
    : null;
}

/** A code block language that matches `codeLanguagePattern`, or `null`. */
export function codeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return codeLanguagePattern.test(lower) ? lower : null;
}

/** A text alignment, or `null`. */
export function textAlign(value: unknown): TextAlign {
  return typeof value === 'string' && (alignments as readonly string[]).includes(value) ? (value as TextAlign) : null;
}

/**
 * A link's `rel`: known tokens only. With `target="_blank"`, `noopener` is always there, and an empty `rel` becomes
 * `defaultBlankRel`.
 */
export function linkRel(rel: unknown, target: '_blank' | null, blankRel: string = defaultBlankRel): string | null {
  const tokens = new Set(
    (typeof rel === 'string' ? rel : '')
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => relTokens.has(token)),
  );
  if (target === '_blank') {
    if (tokens.size === 0) for (const token of blankRel.toLowerCase().split(/\s+/)) if (token) tokens.add(token);
    tokens.add('noopener');
  }
  return tokens.size > 0 ? [...tokens].join(' ') : null;
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Copies `attrs`, replacing the keys present in `fixes`' result only where `attrs` has them. */
function fix(attrs: Attrs, fixes: Record<string, (value: unknown) => unknown>): Attrs {
  const out: Attrs = { ...attrs };
  for (const [key, clean] of Object.entries(fixes)) if (key in out) out[key] = clean(out[key]);
  return out;
}

/** `link`: drops the mark when the href is unsafe; forces `noopener` on `_blank`. */
export function sanitizeLink(attrs: Attrs): Attrs | null {
  const href = safeHref(attrs.href);
  if (!href) return null;
  const target = attrs.target === '_blank' ? '_blank' : null;
  return { href, target, rel: linkRel(attrs.rel, target) };
}

/** `textStyle`: keeps only a palette colour; drops the mark when nothing is left. */
export function sanitizeTextStyle(attrs: Attrs): Attrs | null {
  const color = paletteColor(attrs.color);
  return color ? { color } : null;
}

/** `highlight`: a palette colour or the default (`null`). */
export function sanitizeHighlight(attrs: Attrs): Attrs {
  return { color: paletteColor(attrs.color) };
}

/** `paragraph`: the alignment. */
export function sanitizeParagraph(attrs: Attrs): Attrs {
  return fix(attrs, { textAlign });
}

/** `heading`: a level from 1 to 4 (others are clamped, so the text survives) and the alignment. */
export function sanitizeHeading(attrs: Attrs): Attrs {
  return fix({ level: 2, ...attrs }, { level: (value) => integer(value, 1, 4, 2), textAlign });
}

/** `orderedList`: a whole-number `start` and a known list `type`. */
export function sanitizeOrderedList(attrs: Attrs): Attrs {
  return fix(attrs, {
    start: (value) => integer(value, 0, 1_000_000, 1),
    type: (value) => (typeof value === 'string' && listTypes.has(value) ? value : null),
  });
}

/** `taskItem`: a boolean `checked`. */
export function sanitizeTaskItem(attrs: Attrs): Attrs {
  return { checked: attrs.checked === true || attrs.checked === 'true' };
}

/** `codeBlock`: a language matching `codeLanguagePattern`, or `null`. */
export function sanitizeCodeBlock(attrs: Attrs): Attrs {
  return { language: codeLanguage(attrs.language) };
}

/** `tableCell` and `tableHeader`: spans from 1 to 100 and a column width list that matches the colspan. */
export function sanitizeTableCell(attrs: Attrs): Attrs {
  const colspan = integer(attrs.colspan, 1, maxSpan, 1);
  const rowspan = integer(attrs.rowspan, 1, maxSpan, 1);
  const widths = attrs.colwidth;
  const colwidth =
    Array.isArray(widths) &&
    widths.length === colspan &&
    widths.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0 && w <= maxColumnWidth)
      ? widths.map((w: number) => Math.round(w))
      : null;
  return { colspan, rowspan, colwidth };
}

/** `mention`: an id and label of at most 200 characters, and `@` or `#`. Drops a mention without an id. */
export function sanitizeMention(attrs: Attrs): Attrs | null {
  // Cut by code point, so an emoji at the limit isn't split into a lone surrogate.
  const text = (value: unknown) =>
    typeof value === 'string' ? Array.from(value.trim()).slice(0, 200).join('').trim() : '';
  const id = text(attrs.id);
  if (!id) return null;
  const label = text(attrs.label) || id;
  const mentionSuggestionChar = attrs.mentionSuggestionChar === '#' ? '#' : '@';
  return { id, label, mentionSuggestionChar };
}
