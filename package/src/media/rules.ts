// The media rules shared by the schema, the sanitizer, the editor and the read-only views: limits, the collage maths and
// the layout boxes. Pure, with no React or DOM, so the server can use them.
import type { CollagePlace, GalleryLayout, GalleryPhoto } from '../core/types';

/** The most photos a gallery holds when the features don't say. */
export const defaultMaxPhotos = 10;

/** The hard ceiling on `maxPhotos`, whatever the features say. */
export const maxPhotosCeiling = 50;

/** Longest strings the sanitizer keeps. */
export const textLimits = { alt: 500, caption: 1000, name: 255 } as const;

/** A collage photo's smallest and largest width, as a fraction of the base. */
export const collageMinWidth = 0.08;
export const collageMaxWidth = 1;

/** The narrowest and widest frame a single photo or collage base gets (width ÷ height), from 4:5 to 1.91:1. */
export const minFrameRatio = 0.8;
export const maxFrameRatio = 1.91;

/** A collage frame is never taller than this, in CSS pixels; it narrows instead. */
export const collageMaxHeight = 560;

/** Largest intrinsic size the sanitizer keeps, in pixels. */
export const maxDimension = 100_000;

/** Keeps a number between `min` and `max`. A value that isn't a finite number becomes `fallback`. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Where a photo added to a collage lands: the middle, each later one a step down and right so none hides another. */
export function collageStart(index: number): CollagePlace {
  const step = (Math.max(0, Math.floor(index)) % 6) * 0.04;
  return { x: 0.5 + step, y: 0.5 + step, w: 0.42, r: 0 };
}

/**
 * A collage place kept to the stored rules: the centre on the base (0 to 1), the width between 0.08 and 1 of the base,
 * and the turn within half a circle either way, rounded to 0.1°. Anything that isn't a finite number falls back to the
 * start place.
 */
export function clampPlace(place: unknown, index = 0): CollagePlace {
  const start = collageStart(index);
  const source = place && typeof place === 'object' ? (place as Record<string, unknown>) : {};
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const rawTurn = clampNumber(source.r, -1e6, 1e6, start.r);
  const turn = ((((rawTurn + 180) % 360) + 360) % 360) - 180;
  return {
    x: round(clampNumber(source.x, 0, 1, start.x)),
    y: round(clampNumber(source.y, 0, 1, start.y)),
    w: round(clampNumber(source.w, collageMinWidth, collageMaxWidth, start.w)),
    r: Math.round(turn * 10) / 10 || 0,
  };
}

/** A frame's ratio (width ÷ height) from a picture's size, kept between 4:5 and 1.91:1. */
export function frameRatio(size: { width: number; height: number }): number {
  if (!(size.width > 0) || !(size.height > 0)) return 4 / 3;
  return Math.min(maxFrameRatio, Math.max(minFrameRatio, size.width / size.height));
}

/** A photo's place in a collage: its own, else where a new one lands, stepped by its order. */
export function placeOf(photo: Pick<GalleryPhoto, 'place'>, index: number): CollagePlace {
  return photo.place ?? collageStart(Math.max(0, index - 1));
}

/** The layout a gallery really shows: a collage needs at least two photos, and fewer show as a carousel. */
export function effectiveLayout(layout: GalleryLayout, count: number): GalleryLayout {
  return layout === 'collage' && count < 2 ? 'carousel' : layout;
}

/** CSS for one box, as camel-cased properties, so React and `renderHTML` share the same numbers. */
export interface Box {
  left?: string;
  top?: string;
  width?: string;
  aspectRatio?: string;
  transform?: string;
}

const percent = (fraction: number) => `${Math.round(fraction * 1_000_000) / 10_000}%`;

/**
 * The collage frame's box: the base photo's shape, full width unless that would pass `collageMaxHeight`. Shared by the
 * editor, the React view and the static HTML.
 */
export function collageFrameBox(base: { width: number; height: number }): Box {
  const ratio = frameRatio(base);
  return {
    aspectRatio: String(Math.round(ratio * 10000) / 10000),
    width: `min(100%, ${Math.round(collageMaxHeight * ratio)}px)`,
  };
}

/**
 * Where a photo over the base is drawn: its centre at (x, y) of the frame, its width a share of the frame's, its height
 * from its own proportions, turned by r. Percentages, so the arrangement is the same at any size. Built only from
 * clamped numbers, so nothing from the document reaches the CSS as text.
 */
export function collageItemBox(place: CollagePlace, size: { width: number; height: number }): Box {
  const safe = clampPlace(place);
  const width = size.width > 0 ? Math.round(size.width) : 1;
  const height = size.height > 0 ? Math.round(size.height) : 1;
  return {
    left: percent(safe.x),
    top: percent(safe.y),
    width: percent(safe.w),
    aspectRatio: `${width} / ${height}`,
    transform: `translate(-50%, -50%) rotate(${safe.r}deg)`,
  };
}

/** A box as a `style` attribute value. */
export function boxToStyle(box: Box): string {
  const parts: string[] = [];
  if (box.left) parts.push(`left: ${box.left}`);
  if (box.top) parts.push(`top: ${box.top}`);
  if (box.width) parts.push(`width: ${box.width}`);
  if (box.aspectRatio) parts.push(`aspect-ratio: ${box.aspectRatio}`);
  if (box.transform) parts.push(`transform: ${box.transform}`);
  return parts.join('; ');
}

/** The `sizes` attribute for a gallery photo, so browsers pick a sensible `srcset` entry. */
export function photoSizes(layout: GalleryLayout, count: number, place?: CollagePlace | null): string {
  if (count <= 1) return '(min-width: 760px) 720px, 100vw';
  if (layout === 'collage' && place) return `${Math.ceil(clampPlace(place).w * 720)}px`;
  if (layout === 'carousel') return '360px';
  return '(min-width: 760px) 360px, 50vw';
}

/** A file size for people: "820 B", "14 KB", "3.2 MB". Locale-free on purpose, so the server and the editor agree. */
export function formatBytes(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return '';
  if (Math.round(size) < 1024) return `${Math.round(size)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  // Compare after rounding, so 1048575 bytes reads "1 MB" rather than "1024 KB".
  while (Math.round(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} ${units[unit]}`;
}

/** What kind of file this is, for its icon. */
export type FileKind = 'image' | 'video' | 'audio' | 'archive' | 'sheet' | 'code' | 'text' | 'other';

/** The file's kind, from its type or its name. */
export function fileKind(mimeType: string | null, name: string): FileKind {
  const type = (mimeType ?? '').toLowerCase();
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (/zip|compressed|tar|rar|7z|gzip/.test(type) || /^(zip|rar|7z|gz|tgz|tar|bz2|xz)$/.test(extension))
    return 'archive';
  if (/sheet|excel|csv/.test(type) || /^(xls|xlsx|ods|csv|numbers)$/.test(extension)) return 'sheet';
  if (
    /json|javascript|typescript|xml|x-sh|x-python/.test(type) ||
    /^(js|ts|tsx|jsx|json|py|rb|go|rs|sh|xml|html|css)$/.test(extension)
  )
    return 'code';
  if (type.startsWith('text/') || /pdf|word|document|rtf|presentation|powerpoint/.test(type)) return 'text';
  if (/^(pdf|doc|docx|odt|rtf|txt|md|ppt|pptx|odp|pages|key)$/.test(extension)) return 'text';
  return 'other';
}

/** A short type label for a file card, such as "PDF" or "ZIP", from its name, else its type. */
export function fileTypeLabel(mimeType: string | null, name: string): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  if (extension) return extension.toUpperCase();
  const subtype = /^[a-z]+\/([a-z0-9.+-]{1,20})$/i.exec(mimeType ?? '')?.[1];
  return subtype
    ? subtype
        .replace(/^x-/, '')
        .replace(/^vnd\./, '')
        .toUpperCase()
        .slice(0, 8)
    : '';
}
