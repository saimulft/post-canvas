// @vitest-environment happy-dom
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { generateHTML } from '@tiptap/html/server';
import { describe, expect, it } from 'vitest';
import { defaultFeatures } from '../core/features';
import { sanitizersFor } from '../core/registry';
import { mediaSchema } from './schema';
import { galleryFromFigure, imageFromImg } from './html';
import { cleanSrcset, sanitizeFileAttrs, sanitizeGalleryAttrs, sanitizeImageAttrs } from './sanitize';

const photo = (n: number, extra: Record<string, unknown> = {}) => ({
  key: `k${n}`,
  src: `https://cdn.example.com/${n}.jpg`,
  width: 1200,
  height: 800,
  alt: `Photo ${n}`,
  srcset: null,
  placeholder: null,
  uploadId: null,
  uploadKey: null,
  place: null,
  ...extra,
});

describe('media sources', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:https://app.example.com/0b7c7f8e',
    'vbscript:msgbox(1)',
    '//evil.example.com/a.jpg',
    '/relative/path.jpg',
    '',
  ])('drops the image source %j', (src) => {
    expect(sanitizeImageAttrs({ src, width: 10, height: 10 })).toBeNull();
    expect(sanitizeFileAttrs({ src, name: 'a.pdf' })).toBeNull();
    expect(sanitizeGalleryAttrs({ layout: 'grid', photos: [photo(1, { src })] })).toBeNull();
  });

  it('keeps an https source and clears the upload key', () => {
    const clean = sanitizeImageAttrs({
      src: 'https://cdn.example.com/a.jpg',
      width: 640,
      height: 480,
      uploadKey: 'u1',
    });
    expect(clean).toMatchObject({ src: 'https://cdn.example.com/a.jpg', width: 640, height: 480, uploadKey: null });
  });

  it('drops unsafe photos from a gallery and keeps the rest', () => {
    const clean = sanitizeGalleryAttrs({
      layout: 'grid',
      photos: [
        photo(1),
        photo(2, { src: 'javascript:alert(1)' }),
        photo(3, { src: 'blob:https://x.example/1' }),
        photo(4),
      ],
    });
    expect(clean?.photos.map((p) => p.src)).toEqual(['https://cdn.example.com/1.jpg', 'https://cdn.example.com/4.jpg']);
  });
});

describe('numbers and collage places', () => {
  it('clamps a tampered place', () => {
    const clean = sanitizeGalleryAttrs({
      layout: 'collage',
      photos: [
        photo(1, { place: { x: 0.3, y: 0.3, w: 0.5, r: 10 } }),
        photo(2, { place: { x: Number.NaN, y: 1e308, w: '0.5; background: url(javascript:alert(1))', r: 'turn' } }),
        photo(3, { place: { x: -5, y: 9, w: 99, r: 725.04 } }),
        photo(4, { place: 'x' }),
      ],
    });
    expect(clean).not.toBeNull();
    const [base, second, third, fourth] = clean?.photos ?? [];
    expect(base?.place).toBeNull();
    expect(second?.place).toEqual({ x: 0.5, y: 1, w: 0.42, r: 0 });
    expect(third?.place).toEqual({ x: 0, y: 1, w: 1, r: 5 });
    expect(fourth?.place).toEqual({ x: 0.58, y: 0.58, w: 0.42, r: 0 });
    for (const p of clean?.photos ?? []) {
      if (!p.place) continue;
      for (const value of Object.values(p.place)) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('clamps sizes and drops places outside a collage', () => {
    const clean = sanitizeGalleryAttrs({
      layout: 'grid',
      photos: [photo(1, { width: -4, height: '1e9', place: { x: 0.5, y: 0.5, w: 0.5, r: 0 } })],
    });
    expect(clean?.photos[0]).toMatchObject({ width: 0, height: 100000, place: null });
  });

  it('falls back to an allowed layout', () => {
    const clean = sanitizeGalleryAttrs(
      { layout: 'collage', photos: [photo(1), photo(2)] },
      { maxPhotos: 10, layouts: ['grid'] },
    );
    expect(clean?.layout).toBe('grid');
    expect(sanitizeGalleryAttrs({ layout: 'slideshow', photos: [photo(1)] })?.layout).toBe('carousel');
  });
});

describe('srcset', () => {
  it('drops entries with unsafe URLs one by one', () => {
    expect(cleanSrcset('javascript:alert(1) 640w')).toBeNull();
    expect(cleanSrcset('https://a.example/1.jpg 640w, javascript:alert(1) 1280w, https://a.example/2.jpg 1920w')).toBe(
      'https://a.example/1.jpg 640w, https://a.example/2.jpg 1920w',
    );
    expect(cleanSrcset('https://a.example/1.jpg 640w,data:image/png;base64,AAA 2x')).toBe(
      'https://a.example/1.jpg 640w',
    );
    expect(cleanSrcset('https://a.example/1.jpg 640w onerror=alert(1)')).toBeNull();
  });

  it('cleans the srcset inside a gallery photo', () => {
    const clean = sanitizeGalleryAttrs({ layout: 'grid', photos: [photo(1, { srcset: 'javascript:alert(1) 640w' })] });
    expect(clean?.photos[0]?.srcset).toBeNull();
  });
});

describe('limits and unknown attributes', () => {
  it('cuts photos to the limit', () => {
    const photos = Array.from({ length: 14 }, (_, n) => photo(n));
    expect(sanitizeGalleryAttrs({ layout: 'grid', photos })?.photos).toHaveLength(10);
    expect(sanitizeGalleryAttrs({ layout: 'grid', photos }, { maxPhotos: 3, layouts: ['grid'] })?.photos).toHaveLength(
      3,
    );
  });

  it('uses the feature limits through the schema sanitizer', () => {
    const features = { ...defaultFeatures, gallery: { layouts: ['grid' as const], maxPhotos: 2 } };
    const sanitize = sanitizersFor(mediaSchema(features)).gallery;
    const clean = sanitize?.({ layout: 'collage', photos: [photo(1), photo(2), photo(3)] });
    expect(clean).toMatchObject({ layout: 'grid' });
    expect((clean?.photos as unknown[]).length).toBe(2);
  });

  it('drops unknown attributes', () => {
    const image = sanitizeImageAttrs({
      src: 'https://cdn.example.com/a.jpg',
      onerror: 'alert(1)',
      style: 'background: red',
      class: 'x',
      html: '<b>',
    });
    expect(Object.keys(image ?? {}).sort()).toEqual(
      [
        'align',
        'alt',
        'caption',
        'captionContent',
        'height',
        'id',
        'link',
        'placeholder',
        'src',
        'srcset',
        'uploadId',
        'uploadKey',
        'width',
      ].sort(),
    );
    const gallery = sanitizeGalleryAttrs({ layout: 'grid', photos: [photo(1, { onload: 'x' })], extra: true });
    expect(Object.keys(gallery ?? {}).sort()).toEqual(['caption', 'id', 'layout', 'photos']);
    expect(Object.keys(gallery?.photos[0] ?? {})).not.toContain('onload');
    const file = sanitizeFileAttrs({ src: 'https://cdn.example.com/a.pdf', name: 'a.pdf', download: 'x' });
    expect(Object.keys(file ?? {})).not.toContain('download');
  });

  it('caps strings and keeps only valid placeholders and mime types', () => {
    const image = sanitizeImageAttrs({
      src: 'https://cdn.example.com/a.jpg',
      alt: 'a'.repeat(900),
      caption: 'c'.repeat(1500),
      placeholder: 'data:image/svg+xml;base64,PHN2Zz4=',
    });
    expect(image?.alt).toHaveLength(500);
    expect(image?.caption).toHaveLength(1000);
    expect(image?.placeholder).toBeNull();
    const file = sanitizeFileAttrs({
      src: 'https://cdn.example.com/a.pdf',
      name: 'n'.repeat(300),
      mimeType: 'text/html"><x',
    });
    expect(file?.name).toHaveLength(255);
    expect(file?.mimeType).toBeNull();
  });

  it('strips bidirectional controls and keeps emoji joiners', () => {
    const file = sanitizeFileAttrs({ src: 'https://cdn.example.com/a', name: 'invoice\u202efdp.exe' });
    expect(file?.name).toBe('invoicefdp.exe');
    const image = sanitizeImageAttrs({ src: 'https://cdn.example.com/a.jpg', alt: 'family \u{1F468}\u200d\u{1F469}' });
    expect(image?.alt).toContain('\u200d');
  });

  it('cleans a huge string without copying all of it', () => {
    const image = sanitizeImageAttrs({ src: 'https://cdn.example.com/a.jpg', caption: 'x'.repeat(20_000_000) });
    expect(image?.caption).toHaveLength(1000);
  });

  it('turns a negative or blank size into null', () => {
    expect(sanitizeFileAttrs({ src: 'https://cdn.example.com/a.pdf', size: -5 })?.size).toBeNull();
    expect(sanitizeFileAttrs({ src: 'https://cdn.example.com/a.pdf', size: '' })?.size).toBeNull();
    expect(sanitizeFileAttrs({ src: 'https://cdn.example.com/a.pdf', size: 0 })?.size).toBe(0);
  });

  it('returns null when nothing usable is left', () => {
    expect(sanitizeGalleryAttrs({ layout: 'grid', photos: 'nope' })).toBeNull();
    expect(sanitizeGalleryAttrs({ layout: 'grid', photos: [null, 3, 'x'] })).toBeNull();
  });
});

describe('parsing HTML', () => {
  const parse = (html: string) =>
    new DOMParser().parseFromString(html, 'text/html').body.firstElementChild as HTMLElement;

  it('holds a parsed gallery to its limits, with unique keys and clamped values', () => {
    const items = Array.from(
      { length: 40 },
      () =>
        '<li data-key="k" data-x="NaN" data-y="9" data-w="0.5" data-r="1e9"><img src="https://cdn.example.com/a.jpg" width="1e12" data-upload-id="x y"></li>',
    ).join('');
    const attrs = galleryFromFigure(
      parse(`<figure data-pc-gallery data-layout="collage" data-id="bad id!"><ul>${items}</ul></figure>`),
      {},
      { maxPhotos: 4, layouts: ['grid', 'collage'] },
    );
    expect(attrs).not.toBe(false);
    if (!attrs) return;
    expect(attrs.photos).toHaveLength(4);
    expect(new Set(attrs.photos?.map((p) => p.key)).size).toBe(4);
    expect(attrs.id).toBeUndefined();
    expect(attrs.photos?.[0]?.place).toBeNull();
    expect(attrs.photos?.[1]?.place).toMatchObject({ x: 0.5, y: 1, w: 0.5 });
    const turn = attrs.photos?.[1]?.place?.r ?? Number.NaN;
    expect(turn >= -180 && turn <= 180).toBe(true);
    expect(attrs.photos?.[0]).toMatchObject({ width: 100000, uploadId: null });
    const other = galleryFromFigure(
      parse(`<figure data-pc-gallery data-layout="collage"><ul>${items}</ul></figure>`),
      {},
      { maxPhotos: 4, layouts: ['grid'] },
    );
    expect(other && other.layout).toBe('grid');
  });

  it('keeps remote images and drops unsafe or data: ones without an uploader', () => {
    expect(imageFromImg(parse('<img src="https://cdn.example.com/a.jpg" alt="A">'), {})).toMatchObject({
      src: 'https://cdn.example.com/a.jpg',
      alt: 'A',
    });
    expect(imageFromImg(parse('<img src="javascript:alert(1)">'), {})).toBe(false);
    expect(imageFromImg(parse('<img src="data:image/png;base64,iVBORw0KGgo=">'), {})).toBe(false);
    expect(imageFromImg(parse('<img src="blob:https://x.example/1">'), {})).toBe(false);
  });
});

describe('static HTML', () => {
  const extensions = [Document, Paragraph, Text, ...mediaSchema(defaultFeatures)];
  const injection = '"><img src=x onerror=alert(1)> style="position:fixed" </figcaption><script>alert(1)</script>';

  it('renders a style or markup injection in the caption and alt as escaped text', () => {
    const image = sanitizeImageAttrs({
      src: 'https://cdn.example.com/a.jpg',
      width: 10,
      height: 10,
      alt: injection,
      caption: injection,
    });
    const html = generateHTML({ type: 'doc', content: [{ type: 'image', attrs: image ?? {} }] }, extensions);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelectorAll('img')).toHaveLength(1);
    expect(doc.querySelectorAll('[onerror], [style]')).toHaveLength(0);
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe(injection);
    expect(doc.querySelector('figcaption')?.textContent).toBe(injection);
    expect(html).toContain('&lt;script&gt;');
  });

  it('builds collage styles from clamped numbers only', () => {
    const gallery = sanitizeGalleryAttrs({
      layout: 'collage',
      caption: injection,
      photos: [photo(1), photo(2, { place: { x: '0.5;background:url(javascript:alert(1))', y: 0.5, w: 0.5, r: 0 } })],
    });
    const html = generateHTML({ type: 'doc', content: [{ type: 'gallery', attrs: gallery ?? {} }] }, extensions);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(html).not.toContain('javascript');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelector('figcaption')?.textContent).toBe(injection);
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((match) => match[1]);
    for (const style of styles) expect(style).toMatch(/^[\w\s:;.%()/,-]*$/);
  });
});
