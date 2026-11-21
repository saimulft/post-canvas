// The render-safe media nodes: names, attributes, parseHTML, renderHTML and the sanitizers. No React, no DOM, no node
// views, so the server and the static renderer use exactly the schema the editor uses.
import { Node, type AnyExtension } from '@tiptap/core';
import { captionMarks as allCaptionMarks, type CaptionMark, type Features, type ImageLink } from '../core/types';
import { captionMarksFor } from './caption';
import { fileAttrsOf, galleryAttrsOf, imageAttrsOf } from './coerce';
import {
  fileFromCard,
  fileSpec,
  galleryFromFigure,
  gallerySpec,
  imageFromFigure,
  imageFromImg,
  imageSpec,
  type SourceOptions,
} from './html';
import {
  defaultGalleryLimits,
  galleryLimitsFrom,
  sanitizeFileAttrs,
  sanitizeGalleryAttrs,
  sanitizeImageAttrs,
  type GalleryLimits,
} from './sanitize';

/**
 * An attribute that `renderHTML` and the parse rules handle as a whole: it isn't rendered on its own and isn't read
 * from a same-named HTML attribute (which would let raw markup past the checks).
 */
const attr = <T>(value: T) => ({ default: value, rendered: false, keepOnSplit: false, parseHTML: () => null });

const idAttr = {
  default: null,
  rendered: false,
  keepOnSplit: false,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-id'),
};

const sourceAttrs = () => ({
  src: attr(''),
  width: attr(0),
  height: attr(0),
  alt: attr(''),
  srcset: attr<string | null>(null),
  placeholder: attr<string | null>(null),
  uploadId: attr<string | null>(null),
  uploadKey: attr<string | null>(null),
});

/** Parse rules for the `image` node. */
export function imageParseRules(options: SourceOptions = {}) {
  return [
    { tag: 'figure[data-pc-image]', priority: 60, getAttrs: (el: HTMLElement) => imageFromFigure(el, options) },
    { tag: 'figure', priority: 55, getAttrs: (el: HTMLElement) => imageFromFigure(el, options) },
    { tag: 'img[src]', getAttrs: (el: HTMLElement) => imageFromImg(el, options) },
  ];
}

/** Parse rules for the `gallery` node. */
export function galleryParseRules(options: SourceOptions = {}, limits: GalleryLimits = defaultGalleryLimits) {
  return [
    {
      tag: 'figure[data-pc-gallery]',
      priority: 65,
      getAttrs: (el: HTMLElement) => galleryFromFigure(el, options, limits),
    },
  ];
}

/** Parse rules for the `file` node. */
export function fileParseRules(options: SourceOptions = {}) {
  return [{ tag: 'div[data-pc-file]', priority: 60, getAttrs: (el: HTMLElement) => fileFromCard(el, options) }];
}

/** Options of the `image` node. */
export interface ImageNodeOptions {
  /** The marks a caption may use. */
  captionMarks: readonly CaptionMark[];
}

/**
 * The `image` node for a set of caption marks: the marks the features allow, so a caption never keeps a link when
 * links are off. Its sanitizer enforces them, so it's built per feature set.
 */
export function createImageNode(captionMarks: readonly CaptionMark[] = allCaptionMarks) {
  return Node.create<ImageNodeOptions>({
    name: 'image',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addOptions() {
      return { captionMarks };
    },
    addAttributes() {
      return {
        id: idAttr,
        ...sourceAttrs(),
        caption: attr(''),
        captionContent: attr<unknown[] | null>(null),
        link: attr<ImageLink | null>(null),
        align: attr('center'),
      };
    },
    parseHTML() {
      return imageParseRules({ captionMarks: this.options.captionMarks });
    },
    renderHTML({ node, HTMLAttributes }) {
      return imageSpec(imageAttrsOf(node.attrs), HTMLAttributes);
    },
    postCanvasSanitize: (attrs) => sanitizeImageAttrs(attrs, captionMarks) as Record<string, unknown> | null,
  });
}

/** The `image` block: one picture with a caption (links, bold, italic and the rest), a link and an alignment. */
export const ImageNode = createImageNode();

/** Options of the `gallery` node. */
export interface GalleryNodeOptions {
  /** The allowed layouts and the photo limit. */
  limits: GalleryLimits;
}

/** The `gallery` node for a set of limits. Its sanitizer enforces them, so it's built per feature set. */
export function createGalleryNode(limits: GalleryLimits = defaultGalleryLimits) {
  return Node.create<GalleryNodeOptions>({
    name: 'gallery',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addOptions() {
      return { limits };
    },
    addAttributes() {
      return { id: idAttr, layout: attr('carousel'), photos: attr<unknown[]>([]), caption: attr('') };
    },
    parseHTML() {
      return galleryParseRules({}, this.options.limits);
    },
    renderHTML({ node, HTMLAttributes }) {
      return gallerySpec(galleryAttrsOf(node.attrs), HTMLAttributes);
    },
    postCanvasSanitize: (attrs) => sanitizeGalleryAttrs(attrs, limits) as Record<string, unknown> | null,
  });
}

/** The `gallery` block with every layout and up to 10 photos: carousel, grid, masonry or collage. */
export const GalleryNode = createGalleryNode();

/** The `file` block: an attachment with a download link. */
export const FileNode = Node.create({
  name: 'file',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      id: idAttr,
      src: attr(''),
      name: attr(''),
      size: attr<number | null>(null),
      mimeType: attr<string | null>(null),
      uploadId: attr<string | null>(null),
      uploadKey: attr<string | null>(null),
    };
  },
  parseHTML() {
    return fileParseRules();
  },
  renderHTML({ node, HTMLAttributes }) {
    return fileSpec(fileAttrsOf(node.attrs), HTMLAttributes);
  },
  postCanvasSanitize: (attrs) => sanitizeFileAttrs(attrs) as Record<string, unknown> | null,
});

/** The render-safe media nodes for a feature set. */
export function mediaSchema(features: Features): AnyExtension[] {
  const extensions: AnyExtension[] = [];
  if (features.image) extensions.push(createImageNode(captionMarksFor(features)));
  if (features.gallery) extensions.push(createGalleryNode(galleryLimitsFrom(features.gallery)));
  if (features.file) extensions.push(FileNode);
  return extensions;
}
