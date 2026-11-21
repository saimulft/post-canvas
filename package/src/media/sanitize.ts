// Cleans media attributes from untrusted JSON. Pure: it runs on the server, in `sanitizeDocument`, and never trusts a
// value it didn't build itself. Every function returns only the keys of the contract, so unknown attributes disappear.
import { galleryLayouts } from '../core/types';
import type {
  FileAttrs,
  GalleryAttrs,
  GalleryLayout,
  GalleryPhoto,
  ImageAlign,
  ImageAttrs,
  MediaSource,
} from '../core/types';
import { resolveMediaSrc, safeHttpUrl, safeMediaSrc } from '../core/url';
import { clampNumber, clampPlace, defaultMaxPhotos, maxDimension, maxPhotosCeiling, textLimits } from './rules';

/** What a gallery may hold, from the features. */
export interface GalleryLimits {
  /** Most photos in one gallery. */
  maxPhotos: number;
  /** The layouts a gallery may use. Another layout becomes the first one here. */
  layouts: readonly GalleryLayout[];
}

/** Every layout, at most 10 photos. */
export const defaultGalleryLimits: GalleryLimits = { maxPhotos: defaultMaxPhotos, layouts: galleryLayouts };

const imageAligns: readonly ImageAlign[] = ['center', 'wide', 'full', 'left', 'right'];

/** A tiny LQIP data URL of about 2 KB at most: the prefix plus up to 2,800 base64 characters. */
const maxPlaceholderLength = 2850;
const placeholderPattern = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i;
const idPattern = /^[a-z0-9_-]{1,64}$/i;
const keyPattern = /^[a-z0-9_-]{1,40}$/i;
const uploadIdPattern = /^[\w.:@/+=-]{1,200}$/;
const mimePattern = /^[a-z]+\/[a-z0-9.+-]{1,100}$/i;

// C0 controls and DEL, plus the line and paragraph separators. Newlines and tabs are handled per field.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g;

// Bidirectional controls, which can make a name read differently from what it is ("invoice<RLO>fdp.exe"). Other format
// characters stay: the zero-width joiner builds emoji.
const bidi = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Cuts a string to `max` characters without splitting a character in two. */
function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  return Array.from(value).slice(0, max).join('');
}

/**
 * Plain text on one line: controls and line breaks become spaces, bidirectional controls go, runs of spaces collapse,
 * and it's cut to `max`. A huge input is shortened first, so cleaning it costs little memory.
 */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const head = value.slice(0, max * 4);
  return cut(head.replace(controls, ' ').replace(bidi, '').replace(/\s+/g, ' ').trim(), max);
}

/** Plain text that may keep line breaks: other controls and bidirectional controls go, and it's cut to `max`. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const head = value.slice(0, max * 4);
  return cut(head.replace(/\r\n?/g, '\n').replace(controls, '').replace(bidi, '').replace(/\t/g, ' ').trim(), max);
}

/** A node id, or `null` so the editor assigns a new one. */
export function cleanId(value: unknown): string | null {
  return typeof value === 'string' && idPattern.test(value) ? value : null;
}

/** A positive whole number of pixels, or 0 when unknown. */
export function cleanDimension(value: unknown): number {
  const number = clampNumber(value, 0, maxDimension, 0);
  return number >= 1 ? Math.round(number) : 0;
}

/**
 * A `srcset` with every entry checked on its own: an absolute http(s) URL and a `640w` or `2x` descriptor. Bad entries
 * are dropped; `null` when none is left. With `baseUrl`, relative entries are resolved against it first.
 */
export function cleanSrcset(value: unknown, baseUrl?: string | null): string | null {
  if (typeof value !== 'string' || value.length > 8000) return null;
  const entries: string[] = [];
  // The HTML srcset grammar, simplified: a URL (no spaces), then an optional descriptor up to the next comma. A URL that
  // ends in a comma has no descriptor.
  let at = 0;
  while (at < value.length && entries.length < 12) {
    while (at < value.length && /[\s,]/.test(value.charAt(at))) at++;
    if (at >= value.length) break;
    const start = at;
    while (at < value.length && !/\s/.test(value.charAt(at))) at++;
    let url = value.slice(start, at);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      const from = at;
      while (at < value.length && value.charAt(at) !== ',') at++;
      descriptor = value.slice(from, at).trim();
      at++;
    }
    if (descriptor && !/^(?:\d{1,5}w|\d{1,2}(?:\.\d{1,2})?x)$/.test(descriptor)) continue;
    const safe = safeHttpUrl(url) ?? (baseUrl ? resolveMediaSrc(url, baseUrl) : null);
    if (!safe || /[\s,]/.test(safe)) continue;
    entries.push(descriptor ? `${safe} ${descriptor}` : safe);
  }
  return entries.length > 0 ? entries.join(', ') : null;
}

/** A tiny base64 JPEG, PNG or WebP data URL, or `null`. */
export function cleanPlaceholder(value: unknown): string | null {
  return typeof value === 'string' && value.length <= maxPlaceholderLength && placeholderPattern.test(value)
    ? value
    : null;
}

/** The adapter's upload id, if it's a plain token. */
export function cleanUploadId(value: unknown): string | null {
  return typeof value === 'string' && uploadIdPattern.test(value) ? value : null;
}

/**
 * The shared picture fields. `null` when the source isn't an absolute http(s) URL: `javascript:`, `data:` and `blob:`
 * sources never survive. `uploadKey` is always cleared.
 *
 * One https source is transient but kept here: the editor's staged-upload marker (`https://staged.post-canvas.invalid/…`,
 * a reserved domain that never loads anything). Pasted pictures travel as it through the editor's paste cleaning, which
 * runs these sanitizers. `hasPendingUploads` reports it, and `sanitizeDocument` (which runs these and then its own
 * transient checks) removes it, so it never reaches a saved document.
 */
export function sanitizeMediaSource(attrs: unknown): MediaSource | null {
  const raw = record(attrs);
  const src = safeMediaSrc(raw.src);
  if (!src) return null;
  return {
    src,
    width: cleanDimension(raw.width),
    height: cleanDimension(raw.height),
    alt: cleanLine(raw.alt, textLimits.alt),
    srcset: cleanSrcset(raw.srcset),
    placeholder: cleanPlaceholder(raw.placeholder),
    uploadId: cleanUploadId(raw.uploadId),
    uploadKey: null,
  };
}

/** The `image` node's attributes, cleaned. `null` drops the node. */
export function sanitizeImageAttrs(attrs: Record<string, unknown>): ImageAttrs | null {
  const source = sanitizeMediaSource(attrs);
  if (!source) return null;
  const align = imageAligns.includes(attrs.align as ImageAlign) ? (attrs.align as ImageAlign) : 'center';
  return { id: cleanId(attrs.id) as string, ...source, caption: cleanText(attrs.caption, textLimits.caption), align };
}

/**
 * Puts a gallery's places in order for its layout: in a collage, the first photo (the base) has no place and every
 * other photo has a clamped one; in any other layout no photo has a place.
 */
export function normalizePlaces<T extends Pick<GalleryPhoto, 'place'>>(
  photos: readonly T[],
  layout: GalleryLayout,
): T[] {
  return photos.map((photo, index) => {
    const place = layout === 'collage' && index > 0 ? clampPlace(photo.place ?? undefined, index - 1) : null;
    return { ...photo, place };
  });
}

/** The limits from the features, held within the hard ceiling. */
export function galleryLimitsFrom(gallery: false | { layouts: GalleryLayout[]; maxPhotos: number }): GalleryLimits {
  // Plain-JavaScript callers sometimes pass `true`: anything that isn't an object means the defaults.
  if (!gallery || typeof gallery !== 'object') return defaultGalleryLimits;
  const wanted: unknown = gallery.layouts;
  const layouts = Array.isArray(wanted)
    ? galleryLayouts.filter((layout) => wanted.includes(layout))
    : [...galleryLayouts];
  return {
    maxPhotos: Math.round(clampNumber(gallery.maxPhotos, 1, maxPhotosCeiling, defaultMaxPhotos)),
    layouts: layouts.length > 0 ? layouts : ['carousel'],
  };
}

/**
 * The `gallery` node's attributes, cleaned: each photo checked like an image, at most `maxPhotos`, unique keys, a
 * layout the features allow, and places that follow the collage rules. `null` when no usable photo is left.
 */
export function sanitizeGalleryAttrs(
  attrs: Record<string, unknown>,
  limits: GalleryLimits = defaultGalleryLimits,
): GalleryAttrs | null {
  const rawPhotos = Array.isArray(attrs.photos) ? (attrs.photos as unknown[]).slice(0, maxPhotosCeiling * 2) : [];
  const keys = new Set<string>();
  const photos: GalleryPhoto[] = [];
  for (const rawPhoto of rawPhotos) {
    if (photos.length >= limits.maxPhotos) break;
    const source = sanitizeMediaSource(rawPhoto);
    if (!source) continue;
    const raw = record(rawPhoto);
    let key = typeof raw.key === 'string' && keyPattern.test(raw.key) && !keys.has(raw.key) ? raw.key : '';
    for (let n = photos.length; !key || keys.has(key); n++) key = `p${n}`;
    keys.add(key);
    const place =
      raw.place && typeof raw.place === 'object' ? clampPlace(raw.place, Math.max(0, photos.length - 1)) : null;
    photos.push({ ...source, key, place });
  }
  if (photos.length === 0) return null;
  const allowed = limits.layouts.length > 0 ? limits.layouts : (['carousel'] as const);
  const layout = allowed.includes(attrs.layout as GalleryLayout)
    ? (attrs.layout as GalleryLayout)
    : (allowed[0] ?? 'carousel');
  return {
    id: cleanId(attrs.id) as string,
    layout,
    photos: normalizePlaces(photos, layout),
    caption: cleanText(attrs.caption, textLimits.caption),
  };
}

/** A MIME type such as `application/pdf`, lower-cased, or `null`. */
export function cleanMime(value: unknown): string | null {
  return typeof value === 'string' && mimePattern.test(value) ? value.toLowerCase() : null;
}

/** The `file` node's attributes, cleaned. `null` drops the node. */
export function sanitizeFileAttrs(attrs: Record<string, unknown>): FileAttrs | null {
  const src = safeHttpUrl(attrs.src);
  if (!src) return null;
  const fallbackName = (() => {
    try {
      return decodeURIComponent(new URL(src).pathname.split('/').pop() ?? '');
    } catch {
      return '';
    }
  })();
  const name = cleanLine(attrs.name, textLimits.name) || cleanLine(fallbackName, textLimits.name) || 'file';
  const size = clampNumber(attrs.size, -1, 1e13, -1);
  const mimeType = cleanMime(attrs.mimeType);
  return {
    id: cleanId(attrs.id) as string,
    src,
    name,
    size: size >= 0 && attrs.size !== null && attrs.size !== '' ? Math.round(size) : null,
    mimeType,
    uploadId: cleanUploadId(attrs.uploadId),
    uploadKey: null,
  };
}
