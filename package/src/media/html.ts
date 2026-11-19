// The static HTML of the media nodes (renderHTML) and how it's read back (parseHTML). Render-safe: no React, and the DOM
// is touched only through the element a parse rule hands over. The React views in `view/` draw the same markup.
import type { DOMOutputSpec } from '@tiptap/pm/model';
import type {
  FileAttrs,
  GalleryAttrs,
  GalleryLayout,
  GalleryPhoto,
  ImageAlign,
  ImageAttrs,
  MediaSource,
} from '../core/types';
import { safeHttpUrl, safeMediaSrc, stagedSrcPrefix } from '../core/url';
import {
  boxToStyle,
  clampPlace,
  collageFrameBox,
  collageItemBox,
  effectiveLayout,
  fileKind,
  fileTypeLabel,
  formatBytes,
  frameRatio,
  photoSizes,
  placeOf,
  textLimits,
} from './rules';
import {
  cleanDimension,
  cleanId,
  cleanLine,
  cleanMime,
  cleanPlaceholder,
  cleanSrcset,
  cleanText,
  cleanUploadId,
  defaultGalleryLimits,
  normalizePlaces,
  type GalleryLimits,
} from './sanitize';

type Attrs = Record<string, string>;

/** How parse rules treat sources that aren't plain http(s). */
export interface SourceOptions {
  /**
   * Turns a pasted `data:` image into a source, usually by staging an upload. Return `null` to drop it. Without this,
   * `data:` images are dropped.
   */
  fromDataUrl?: (dataUrl: string, name: string) => { src: string; uploadKey: string } | null;
  /** The local preview of an upload this editor already staged, for a `data-upload-key` it knows. */
  previewOf?: (uploadKey: string) => string | null;
  /** True for a `blob:` URL this editor made itself, which stays usable for as long as the page is open. */
  ownsBlob?: (url: string) => boolean;
}

export { stagedSrcPrefix };

/** The `img` attributes shared by every picture. */
export function imgAttrs(source: MediaSource, extra: { className: string; sizes?: string; style?: string }): Attrs {
  const attrs: Attrs = { class: extra.className };
  const src = safeMediaSrc(source.src, { allowBlob: true });
  if (src) attrs.src = src;
  attrs.alt = source.alt;
  if (source.width > 0 && source.height > 0) {
    attrs.width = String(source.width);
    attrs.height = String(source.height);
  }
  const srcset = cleanSrcset(source.srcset);
  if (srcset) {
    attrs.srcset = srcset;
    attrs.sizes = extra.sizes ?? '100vw';
  }
  attrs.loading = 'lazy';
  attrs.decoding = 'async';
  if (source.uploadId) attrs['data-upload-id'] = source.uploadId;
  if (source.uploadKey) attrs['data-upload-key'] = source.uploadKey;
  // The one document value that reaches `style` as text: only a strict base64 JPEG, PNG or WebP data URL of at most
  // about 2 KB passes cleanPlaceholder, so it can't close the url() or add a declaration.
  const placeholder = cleanPlaceholder(source.placeholder);
  const style = [extra.style, placeholder ? `background-image: url(${placeholder})` : ''].filter(Boolean).join('; ');
  if (style) attrs.style = style;
  return attrs;
}

const withRoot = (root: Attrs, html: Record<string, unknown>): Attrs => {
  const merged: Attrs = { ...root };
  for (const [key, value] of Object.entries(html)) {
    if (key === 'class' || key === 'style' || key in merged) continue;
    if (typeof value === 'string' || typeof value === 'number') merged[key] = String(value);
  }
  return merged;
};

/** The `image` node as `figure > img + figcaption`. */
export function imageSpec(attrs: ImageAttrs, html: Record<string, unknown> = {}): DOMOutputSpec {
  const root: Attrs = { class: `pc-image pc-image--${attrs.align}`, 'data-pc-image': '', 'data-align': attrs.align };
  if (attrs.id) root['data-id'] = attrs.id;
  const img: DOMOutputSpec = [
    'img',
    imgAttrs(attrs, { className: 'pc-image__img', sizes: '(min-width: 760px) 720px, 100vw' }),
  ];
  return attrs.caption
    ? ['figure', withRoot(root, html), img, ['figcaption', { class: 'pc-image__caption' }, attrs.caption]]
    : ['figure', withRoot(root, html), img];
}

/** One gallery photo as an `li`. */
function photoSpec(photo: GalleryPhoto, index: number, layout: string, count: number): DOMOutputSpec {
  const li: Attrs = { class: 'pc-gallery__item', 'data-key': photo.key };
  if (layout === 'collage') {
    if (index === 0) {
      li.class += ' pc-gallery__item--base';
    } else {
      const place = clampPlace(placeOf(photo, index), index - 1);
      li.class += ' pc-gallery__item--layer';
      li['data-x'] = String(place.x);
      li['data-y'] = String(place.y);
      li['data-w'] = String(place.w);
      li['data-r'] = String(place.r);
      li.style = boxToStyle(collageItemBox(place, photo));
    }
  } else if (count === 1) {
    li.style = `aspect-ratio: ${Math.round(frameRatio(photo) * 10000) / 10000}`;
  }
  const place = index > 0 ? clampPlace(placeOf(photo, index), index - 1) : null;
  const sizes = photoSizes(layout as GalleryAttrs['layout'], count, place);
  return ['li', li, ['img', imgAttrs(photo, { className: 'pc-gallery__img', sizes })]];
}

/** The `gallery` node as `figure > ul > li > img`, plus a caption. The carousel scrolls with CSS scroll-snap. */
export function gallerySpec(attrs: GalleryAttrs, html: Record<string, unknown> = {}): DOMOutputSpec {
  const count = attrs.photos.length;
  const shown = count === 1 ? 'single' : effectiveLayout(attrs.layout, count);
  const root: Attrs = {
    class: `pc-gallery pc-gallery--${shown}`,
    'data-pc-gallery': '',
    'data-layout': attrs.layout,
    'data-count': String(count),
  };
  if (attrs.id) root['data-id'] = attrs.id;
  const list: Attrs = { class: 'pc-gallery__list' };
  if (shown === 'collage' && attrs.photos[0]) list.style = boxToStyle(collageFrameBox(attrs.photos[0]));
  if (shown === 'carousel') list.tabindex = '0';
  const items = attrs.photos.map((photo, index) => photoSpec(photo, index, shown, count));
  const ul: DOMOutputSpec = ['ul', list, ...items];
  return attrs.caption
    ? ['figure', withRoot(root, html), ul, ['figcaption', { class: 'pc-gallery__caption' }, attrs.caption]]
    : ['figure', withRoot(root, html), ul];
}

/** The `file` node as a card with a download link. */
export function fileSpec(attrs: FileAttrs, html: Record<string, unknown> = {}): DOMOutputSpec {
  const kind = fileKind(attrs.mimeType, attrs.name);
  const root: Attrs = { class: 'pc-file', 'data-pc-file': '', 'data-kind': kind, 'data-name': attrs.name };
  if (attrs.id) root['data-id'] = attrs.id;
  if (attrs.size !== null) root['data-size'] = String(attrs.size);
  if (attrs.mimeType) root['data-mime'] = attrs.mimeType;
  if (attrs.uploadKey) root['data-upload-key'] = attrs.uploadKey;
  const href = safeMediaSrc(attrs.src, { allowBlob: true });
  const meta = [fileTypeLabel(attrs.mimeType, attrs.name), formatBytes(attrs.size)].filter(Boolean).join(' · ');
  const body: DOMOutputSpec[] = [
    ['span', { class: 'pc-file__badge', 'aria-hidden': 'true' }, fileTypeLabel(attrs.mimeType, attrs.name) || 'FILE'],
    [
      'span',
      { class: 'pc-file__body' },
      ['span', { class: 'pc-file__name' }, attrs.name],
      ['span', { class: 'pc-file__meta' }, meta],
    ],
  ];
  const link: Attrs = { class: 'pc-file__link' };
  if (href) {
    link.href = href;
    link.download = attrs.name;
    link.target = '_blank';
    link.rel = 'noopener noreferrer nofollow';
  }
  if (attrs.uploadId) link['data-upload-id'] = attrs.uploadId;
  return ['div', withRoot(root, html), [href ? 'a' : 'span', link, ...body]];
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------

/** The placeholder from an `img`'s `background-image` style. */
function placeholderOf(img: Element): string | null {
  const match = /url\(\s*["']?(data:image\/[a-z]+;base64,[a-z0-9+/=]+)["']?\s*\)/i.exec(
    img.getAttribute('style') ?? '',
  );
  return cleanPlaceholder(match?.[1] ?? null);
}

/**
 * A picture from an `img` element. `null` when its source isn't usable: http(s) always; a picture this editor is
 * uploading (a `data-upload-key` that `previewOf` knows) as the staged marker; `data:` only through `fromDataUrl`.
 */
export function sourceFromImg(img: Element, options: SourceOptions = {}): MediaSource | null {
  const raw = (img.getAttribute('src') ?? '').trim();
  let src = safeMediaSrc(raw);
  let uploadKey: string | null = null;
  const key = img.getAttribute('data-upload-key');
  if (key && options.previewOf?.(key)) {
    // A picture this editor is uploading (pasted, or copied within the editor): it travels as the staged marker, which
    // survives any sanitizer on the way, and the upload plugin links it back to its preview.
    src = `${stagedSrcPrefix}${key}`;
    uploadKey = key;
  } else if (!src && options.ownsBlob?.(raw)) {
    src = raw;
  } else if (!src && options.fromDataUrl && /^data:image\//i.test(raw)) {
    const fromData = options.fromDataUrl(raw, cleanLine(img.getAttribute('alt'), 80) || 'image');
    if (fromData) {
      src = `${stagedSrcPrefix}${fromData.uploadKey}`;
      uploadKey = fromData.uploadKey;
    }
  }
  if (!src) return null;
  return {
    src,
    width: cleanDimension(img.getAttribute('width')),
    height: cleanDimension(img.getAttribute('height')),
    alt: cleanLine(img.getAttribute('alt'), textLimits.alt),
    srcset: cleanSrcset(img.getAttribute('srcset')),
    placeholder: placeholderOf(img),
    uploadId: cleanUploadId(img.getAttribute('data-upload-id')),
    uploadKey,
  };
}

const alignOf = (value: string | null): ImageAlign =>
  value === 'wide' || value === 'full' || value === 'left' || value === 'right' ? value : 'center';

/** An `image` node from our own `figure[data-pc-image]` or any `figure` holding one `img`. */
export function imageFromFigure(figure: HTMLElement, options: SourceOptions): Partial<ImageAttrs> | false {
  const images = figure.querySelectorAll('img');
  if (images.length !== 1 || !images[0]) return false;
  if (!figure.hasAttribute('data-pc-image') && figure.querySelector('video, iframe, table, pre, ul, ol')) return false;
  const source = sourceFromImg(images[0], options);
  if (!source) return false;
  const caption = figure.querySelector(':scope > figcaption');
  return {
    ...source,
    id: cleanId(figure.getAttribute('data-id')) ?? undefined,
    caption: cleanText(caption?.textContent ?? '', textLimits.caption),
    align: alignOf(figure.getAttribute('data-align')),
  };
}

/** An `image` node from a bare `img`. */
export function imageFromImg(img: HTMLElement, options: SourceOptions): Partial<ImageAttrs> | false {
  const source = sourceFromImg(img, options);
  return source ? { ...source, caption: '', align: 'center' } : false;
}

/**
 * A `gallery` node from our own `figure[data-pc-gallery]`, held to the gallery's limits: at most `maxPhotos`, unique
 * photo keys, an allowed layout and places that follow the collage rules.
 */
export function galleryFromFigure(
  figure: HTMLElement,
  options: SourceOptions,
  limits: GalleryLimits = defaultGalleryLimits,
): Partial<GalleryAttrs> | false {
  const photos: GalleryPhoto[] = [];
  const keys = new Set<string>();
  for (const li of Array.from(figure.querySelectorAll('li'))) {
    if (photos.length >= limits.maxPhotos) break;
    const img = li.querySelector('img');
    const source = img ? sourceFromImg(img, options) : null;
    if (!source) continue;
    const wanted = li.getAttribute('data-key') ?? '';
    let key = /^[a-z0-9_-]{1,40}$/i.test(wanted) && !keys.has(wanted) ? wanted : '';
    for (let n = photos.length; !key || keys.has(key); n++) key = `p${n}`;
    keys.add(key);
    const place = li.hasAttribute('data-x')
      ? {
          x: Number(li.getAttribute('data-x')),
          y: Number(li.getAttribute('data-y')),
          w: Number(li.getAttribute('data-w')),
          r: Number(li.getAttribute('data-r')),
        }
      : null;
    photos.push({ ...source, key, place });
  }
  if (photos.length === 0) return false;
  const wantedLayout = figure.getAttribute('data-layout') as GalleryLayout | null;
  const layout =
    wantedLayout && limits.layouts.includes(wantedLayout) ? wantedLayout : (limits.layouts[0] ?? 'carousel');
  const caption = figure.querySelector(':scope > figcaption');
  return {
    id: cleanId(figure.getAttribute('data-id')) ?? undefined,
    layout,
    photos: normalizePlaces(photos, layout),
    caption: cleanText(caption?.textContent ?? '', textLimits.caption),
  };
}

/** A `file` node from our own `div[data-pc-file]`. */
export function fileFromCard(card: HTMLElement, options: SourceOptions): Partial<FileAttrs> | false {
  const link = card.querySelector('a[href]');
  const raw = link?.getAttribute('href') ?? '';
  let src = safeHttpUrl(raw);
  let uploadKey: string | null = null;
  const key = card.getAttribute('data-upload-key');
  if (key && options.previewOf?.(key)) {
    src = `${stagedSrcPrefix}${key}`;
    uploadKey = key;
  } else if (!src && options.ownsBlob?.(raw)) {
    src = raw;
  }
  if (!src) return false;
  const size = Number(card.getAttribute('data-size') ?? Number.NaN);
  return {
    id: cleanId(card.getAttribute('data-id')) ?? undefined,
    src,
    name: cleanLine(card.getAttribute('data-name'), textLimits.name) || 'file',
    size: Number.isFinite(size) && size >= 0 ? Math.min(1e13, Math.round(size)) : null,
    mimeType: cleanMime(card.getAttribute('data-mime')),
    uploadId: cleanUploadId(link?.getAttribute('data-upload-id')),
    uploadKey,
  };
}
