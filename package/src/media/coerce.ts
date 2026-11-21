// Gives media attributes their contract shape before they're drawn, whatever they came from. Unlike the sanitizer it
// keeps `blob:` previews and upload keys, because the editor draws those too; the drawing code still checks every URL
// and number, so a value that slips through can't become markup.
import type {
  CaptionContent,
  CollagePlace,
  FileAttrs,
  GalleryAttrs,
  GalleryPhoto,
  ImageAlign,
  ImageAttrs,
  ImageLink,
  MediaSource,
} from '../core/types';

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const nullableText = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const size = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

const aligns: readonly ImageAlign[] = ['center', 'wide', 'full', 'left', 'right'];

function sourceOf(raw: Record<string, unknown>): MediaSource {
  return {
    src: text(raw.src),
    width: size(raw.width),
    height: size(raw.height),
    alt: text(raw.alt),
    srcset: nullableText(raw.srcset),
    placeholder: nullableText(raw.placeholder),
    uploadId: nullableText(raw.uploadId),
    uploadKey: nullableText(raw.uploadKey),
  };
}

const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A picture's link in its contract shape, or `null`. The drawing code still checks the href. */
function linkOf(value: unknown): ImageLink | null {
  const link = recordOf(value);
  if (typeof link.href !== 'string' || !link.href) return null;
  return {
    href: link.href,
    target: link.target === '_blank' ? '_blank' : null,
    rel: typeof link.rel === 'string' && link.rel ? link.rel : null,
  };
}

/** `image` attributes in their contract shape. */
export function imageAttrsOf(raw: Record<string, unknown>): ImageAttrs {
  return {
    id: text(raw.id),
    ...sourceOf(raw),
    caption: text(raw.caption),
    captionContent: Array.isArray(raw.captionContent) ? (raw.captionContent as CaptionContent) : null,
    link: linkOf(raw.link),
    align: aligns.includes(raw.align as ImageAlign) ? (raw.align as ImageAlign) : 'center',
  };
}

function placeOf(value: unknown): CollagePlace | null {
  if (!value || typeof value !== 'object') return null;
  const place = value as Record<string, unknown>;
  return { x: Number(place.x), y: Number(place.y), w: Number(place.w), r: Number(place.r) };
}

/** `gallery` attributes in their contract shape. Photos that aren't objects are left out. */
export function galleryAttrsOf(raw: Record<string, unknown>): GalleryAttrs {
  const photos: GalleryPhoto[] = (Array.isArray(raw.photos) ? (raw.photos as unknown[]) : [])
    .filter((photo) => photo && typeof photo === 'object')
    .map((photo, index) => {
      const record = recordOf(photo);
      return { ...sourceOf(record), key: text(record.key, `p${index}`), place: placeOf(record.place) };
    });
  const layout = raw.layout;
  return {
    id: text(raw.id),
    layout: layout === 'grid' || layout === 'masonry' || layout === 'collage' ? layout : 'carousel',
    photos,
    caption: text(raw.caption),
  };
}

/** `file` attributes in their contract shape. */
export function fileAttrsOf(raw: Record<string, unknown>): FileAttrs {
  return {
    id: text(raw.id),
    src: text(raw.src),
    name: text(raw.name, 'file') || 'file',
    size: typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : null,
    mimeType: nullableText(raw.mimeType),
    uploadId: nullableText(raw.uploadId),
    uploadKey: nullableText(raw.uploadKey),
  };
}
