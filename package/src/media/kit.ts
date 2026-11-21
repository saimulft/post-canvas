// The editor media extensions: the schema nodes with their React node views, the upload pipeline, paste and drop,
// the commands, the + and / items, and the problems that block publishing.
import { Extension, type AnyExtension, type Editor, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import FileHandler from '@tiptap/extension-file-handler';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Images, Image as ImageIcon, Paperclip } from 'lucide-react';
import type {
  CaptionContent,
  Features,
  GalleryAttrs,
  GalleryLayout,
  GalleryPhoto,
  InsertItem,
  Problem,
} from '../core/types';
import { createKey } from '../core/ids';
import { safeMediaSrc } from '../core/url';
import { galleryAttrsOf } from './coerce';
import { FileNodeView } from './editor/file-node-view';
import { GalleryNodeView } from './editor/gallery-node-view';
import { ImageNodeView } from './editor/image-node-view';
import { mediaStopEvent } from '../core/react/node-view';
import { stagedSrcPrefix, type SourceOptions } from './html';
import { dataUrlToFile, htmlHasText } from './paste';
import { captionFields, captionMarksFor } from './caption';
import { createGalleryNode, createImageNode, FileNode, fileParseRules, galleryParseRules, imageParseRules } from './schema';
import { galleryLimitsFrom, normalizePlaces, sanitizeImageLink } from './sanitize';
import type { MediaStorage } from './storage';
import { UploadManager } from './upload/manager';
import { prepareImage } from './upload/prepare';
import { imageAccept, openFilePicker } from './upload/picker';
import { firstLayout, findNode, uploadFiles, type UploadTarget } from './upload/pipeline';
import { createPositionPlugin, createUploadPlugin, patchUploads, uploadPluginKey } from './upload/plugin';

/** What `insertImage` takes: a finished picture, with an http(s) `src`. */
export interface InsertImageOptions {
  /** An http or https URL. Anything else is refused. */
  src: string;
  /** Intrinsic width in pixels. Leave out to have the editor measure the picture when it loads. */
  width?: number;
  /** Intrinsic height in pixels. Leave out to have the editor measure the picture when it loads. */
  height?: number;
  /** Alternative text. Default empty. */
  alt?: string;
  /** Plain text under the picture. Default empty. */
  caption?: string;
  /** The caption with formatting (links, bold, italic and the rest). Replaces `caption` when it has text. */
  captionContent?: CaptionContent | null;
  /** Where the picture links to. Unsafe addresses are refused. */
  link?: { href: string; target?: '_blank' | null } | null;
  /** Where the picture sits. Default `center`. */
  align?: 'center' | 'wide' | 'full' | 'left' | 'right';
  /** A `srcset` such as `"url 640w, url 1280w"`. Invalid entries are dropped. */
  srcset?: string | null;
  /** A tiny `data:image/(jpeg|png|webp);base64` preview of at most 2 KB. */
  placeholder?: string | null;
  /** Your storage's id for the picture. */
  uploadId?: string | null;
}

/** What `insertGallery` takes: finished photos, with http(s) sources. */
export interface InsertGalleryOptions {
  /** Default `carousel`, or the first layout the features allow. */
  layout?: GalleryLayout;
  /** The photos, each with an http or https `src`. Extra photos past `maxPhotos` are left out. */
  photos: Array<Partial<GalleryPhoto> & { src: string }>;
  /** Plain text under the gallery. Default empty. */
  caption?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    postCanvasMedia: {
      /** Inserts an `image` block from a finished picture. */
      insertImage: (options: InsertImageOptions) => ReturnType;
      /** Inserts a `gallery` block from finished photos. */
      insertGallery: (options: InsertGalleryOptions) => ReturnType;
      /** Uploads files and inserts them at the selection: pictures as an image or a gallery, others as file blocks. */
      insertFiles: (files: File[]) => ReturnType;
      /** Changes a gallery's layout: the selected gallery, or the one with `nodeId`. */
      setGalleryLayout: (layout: GalleryLayout, nodeId?: string) => ReturnType;
      /** Uploads pictures into a gallery: the selected one, or the one with `nodeId`. */
      addGalleryPhotos: (files: File[], nodeId?: string) => ReturnType;
      /** Checks, prepares and uploads files, and puts them where `target` says. */
      uploadFiles: (files: File[], target?: UploadTarget) => ReturnType;
    };
  }
}

const imageInputTypes = ['image', 'gallery', 'file'];

/** The gallery the selection is on, or the one with `nodeId`. */
function galleryAt(editor: Editor, nodeId?: string) {
  if (nodeId) {
    const found = findNode(editor.state.doc, nodeId);
    return found?.node.type.name === 'gallery' ? found : null;
  }
  const { selection } = editor.state;
  const node = editor.state.doc.nodeAt(selection.from);
  return node?.type.name === 'gallery' ? { node, pos: selection.from } : null;
}

/** True for an event inside an image's caption editor. */
function inCaptionEditor(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.pc-caption-editor') !== null;
}

/** A picture source the editor accepts in a command: http(s) only, so commands never bring in `javascript:`. */
const commandSrc = (src: unknown) => safeMediaSrc(src);

/** Runs an insert item: drops the typed `/` text, then asks for files. */
function insertFrom(editor: Editor, range: { from: number; to: number } | undefined, as: 'image' | 'gallery' | 'file') {
  if (range) editor.chain().focus().deleteRange(range).run();
  const upload = editor.storage.postCanvasCore.adapters.upload;
  const accept = as === 'file' ? upload?.accept?.file : imageAccept(upload?.accept?.image);
  void openFilePicker({ ...(accept ? { accept } : {}), multiple: as !== 'image' }).then((files) => {
    if (files.length > 0) void uploadFiles(editor, files, { type: 'cursor', as });
  });
}

/** Editor parse options: pictures this editor is uploading (by their key), and pasted `data:` pictures staged for upload. */
function editorSourceOptions(editor: Editor | undefined): SourceOptions {
  return {
    previewOf: (key) => editor?.storage.postCanvasMedia?.manager?.get(key)?.preview ?? null,
    ownsBlob: (url) => editor?.storage.postCanvasMedia?.manager?.owns(url) ?? false,
    // Read when a rule runs: the parse rules are built before the storage exists, and the base can change.
    get baseUrl() {
      return editor?.storage.postCanvasCore?.baseUrl ?? null;
    },
    fromDataUrl: (dataUrl, name) => {
      const manager = editor?.storage.postCanvasMedia?.manager;
      const upload = editor?.storage.postCanvasCore.adapters.upload;
      if (!manager || !upload) return null;
      const file = dataUrlToFile(dataUrl, name);
      if (!file) return null;
      const max = upload.maxBytes?.image;
      if (max !== undefined && file.size > max) return null;
      // Checked, converted and scaled like a picked file, just before its upload starts.
      const uploadKey = manager.stage(file, 'image', null, { prepare: true });
      const src = manager.get(uploadKey)?.preview;
      return src ? { src, uploadKey } : null;
    },
  };
}

/**
 * Gets pasted pictures past any later paste cleaning that keeps only http(s) sources: one this editor is uploading
 * (copied within the editor, so it carries a known `data-upload-key`) and every `data:` picture, which is staged for
 * upload, both travel as the staged marker. A `data:` picture is dropped when there's no uploader.
 */
function stagePastedImages(editor: Editor, html: string): string {
  if (!/data:|data-upload-key/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const options = editorSourceOptions(editor);
  doc.querySelectorAll('img').forEach((img) => {
    const known = img.getAttribute('data-upload-key');
    if (known && options.previewOf?.(known)) {
      img.setAttribute('src', `${stagedSrcPrefix}${known}`);
      return;
    }
    const raw = (img.getAttribute('src') ?? '').trim();
    if (!/^data:/i.test(raw)) return;
    const staged = options.fromDataUrl?.(raw, img.getAttribute('alt') || 'image') ?? null;
    if (!staged) {
      img.remove();
      return;
    }
    img.setAttribute('src', `${stagedSrcPrefix}${staged.uploadKey}`);
    img.setAttribute('data-upload-key', staged.uploadKey);
  });
  doc.querySelectorAll('div[data-pc-file][data-upload-key] a').forEach((link) => {
    const key = link.closest('[data-upload-key]')?.getAttribute('data-upload-key');
    if (key && options.previewOf?.(key)) link.setAttribute('href', `${stagedSrcPrefix}${key}`);
  });
  return doc.body.innerHTML;
}

/**
 * The upload side of the media kit: the upload manager, the plugins, paste and drop through FileHandler, the commands
 * and the problems.
 */
export const MediaUploads = Extension.create<Record<string, never>, MediaStorage>({
  name: 'postCanvasMedia',
  // Before the text kit, so its paste cleaning sees staged pictures instead of `data:` ones.
  priority: 200,

  addStorage() {
    return { manager: null };
  },

  onBeforeCreate() {
    const editor = this.editor;
    let scheduled = false;
    const failed: string[] = [];
    // Status changes reach the document (a finished upload) or at least the listeners (problems), after the current
    // update, so nothing dispatches while ProseMirror is still applying a state.
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const manager = editor.storage.postCanvasMedia.manager;
        if (editor.isDestroyed || !manager) return;
        const patch = patchUploads(editor.state, manager);
        editor.view.dispatch(
          patch ?? editor.state.tr.setMeta(uploadPluginKey, 'status').setMeta('addToHistory', false),
        );
      });
    };
    this.storage.manager = new UploadManager({
      getAdapter: () => editor.storage.postCanvasCore.adapters.upload,
      prepare: async (file) => {
        const upload = editor.storage.postCanvasCore.adapters.upload;
        const prepared = await prepareImage(file, {
          maxBytes: upload?.maxBytes?.image,
          convertHeic: upload?.convertHeic,
        });
        return prepared.file;
      },
      onChange: (entry) => {
        refresh();
        if (entry.status !== 'failed') return;
        if (entry.error) console.warn(`[post-canvas] Upload of ${entry.file.name} failed: ${entry.error}`);
        // Failures that land together (a batch) make one notice, not one per photo.
        failed.push(entry.file.name);
        if (failed.length > 1) return;
        setTimeout(() => {
          const names = failed.splice(0);
          if (editor.isDestroyed || names.length === 0) return;
          const core = editor.storage.postCanvasCore;
          const message =
            names.length === 1
              ? core.t('media.upload.failed', { name: names[0] ?? '' })
              : core.t('media.upload.failedMany', { count: names.length });
          core.notify(message, 'error');
        }, 400);
      },
    });
  },

  onDestroy() {
    this.storage.manager?.destroy();
    this.storage.manager = null;
  },

  addExtensions() {
    return [
      FileHandler.configure({
        consumePasteEvent: true,
        onDrop: (editor, files, pos) => void uploadFiles(editor, files, { type: 'at', pos }),
        onPaste: (editor, files, html) => {
          // A document copied from an office app comes with a picture of itself: paste the document, not the picture.
          if (html && htmlHasText(html)) editor.view.pasteHTML(html);
          else void uploadFiles(editor, files, { type: 'cursor' });
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      createUploadPlugin(() => this.storage.manager),
      createPositionPlugin(),
      // Pasted `data:` pictures are staged for upload here, before any other paste cleaning sees them (this extension
      // runs early), so a cleaner that only keeps http(s) pictures doesn't drop them. Without an uploader they go.
      new Plugin({
        key: new PluginKey('postCanvasMediaPaste'),
        props: { transformPastedHTML: (html) => stagePastedImages(editor, html) },
      }),
      plainPastePlugin(),
    ];
  },

  addCommands() {
    return {
      insertImage:
        (options) =>
        ({ commands }) => {
          const src = commandSrc(options.src);
          if (!src) return false;
          return commands.insertContent({
            type: 'image',
            attrs: {
              src,
              width: options.width ?? 0,
              height: options.height ?? 0,
              alt: options.alt ?? '',
              ...captionFields(options.caption ?? '', options.captionContent ?? null),
              link: sanitizeImageLink(options.link ?? null),
              align: options.align ?? 'center',
              srcset: options.srcset ?? null,
              placeholder: options.placeholder ?? null,
              uploadId: options.uploadId ?? null,
            },
          });
        },
      insertGallery:
        (options) =>
        ({ commands, editor }) => {
          const limits = galleryLimitsFrom(editor.storage.postCanvasCore.features.gallery);
          const layout =
            options.layout && limits.layouts.includes(options.layout)
              ? options.layout
              : firstLayout(editor.storage.postCanvasCore.features);
          const photos = galleryAttrsOf({ photos: options.photos })
            .photos.filter((photo) => commandSrc(photo.src))
            .slice(0, limits.maxPhotos)
            .map((photo, index, list) => {
              const unique =
                /^[\w-]{1,40}$/.test(photo.key) && list.findIndex((other) => other.key === photo.key) === index;
              return { ...photo, key: unique ? photo.key : createKey('p'), uploadKey: null };
            });
          if (photos.length === 0) return false;
          return commands.insertContent({
            type: 'gallery',
            attrs: { layout, photos: normalizePlaces(photos, layout), caption: options.caption ?? '' },
          } satisfies JSONContent);
        },
      insertFiles:
        (files) =>
        ({ editor }) => {
          void uploadFiles(editor, files, { type: 'cursor' });
          return true;
        },
      setGalleryLayout:
        (layout, nodeId) =>
        ({ editor, tr, dispatch }) => {
          const found = galleryAt(editor, nodeId);
          const limits = galleryLimitsFrom(editor.storage.postCanvasCore.features.gallery);
          if (!found || !limits.layouts.includes(layout)) return false;
          const attrs = found.node.attrs as GalleryAttrs;
          if (dispatch) {
            tr.setNodeAttribute(found.pos, 'layout', layout);
            tr.setNodeAttribute(found.pos, 'photos', normalizePlaces(attrs.photos, layout));
          }
          return true;
        },
      addGalleryPhotos:
        (files, nodeId) =>
        ({ editor }) => {
          const found = galleryAt(editor, nodeId);
          const id = found?.node.attrs.id as string | undefined;
          if (!id) return false;
          void uploadFiles(editor, files, { type: 'gallery', nodeId: id });
          return true;
        },
      uploadFiles:
        (files, target = { type: 'cursor' }) =>
        ({ editor }) => {
          void uploadFiles(editor, files, target);
          return true;
        },
    };
  },

  postCanvasProblems() {
    const { editor } = this;
    // The registry hands over the extension's default storage; the live manager is on the editor.
    const manager = editor.storage.postCanvasMedia?.manager ?? null;
    const { t } = editor.storage.postCanvasCore;
    const problems: Problem[] = [];
    const stateOf = (key: string | null) => {
      if (!key) return 'none';
      const entry = manager?.get(key);
      if (!entry || entry.status === 'failed') return 'failed';
      return entry.status === 'done' ? 'none' : 'uploading';
    };
    editor.state.doc.descendants((node) => {
      if (!imageInputTypes.includes(node.type.name)) return true;
      const nodeId = typeof node.attrs.id === 'string' ? node.attrs.id : undefined;
      if (node.type.name === 'gallery') {
        const photos = (node.attrs.photos ?? []) as GalleryPhoto[];
        const states = photos.map((photo) => stateOf(photo.uploadKey));
        const failed = states.filter((state) => state === 'failed').length;
        const uploading = states.filter((state) => state === 'uploading').length;
        if (failed > 0)
          problems.push({
            code: 'media.failed',
            message: t('media.problem.galleryFailed', { count: failed }),
            severity: 'error',
            nodeId,
          });
        if (uploading > 0)
          problems.push({
            code: 'media.uploading',
            message: t('media.problem.galleryUploading', { count: uploading }),
            severity: 'error',
            nodeId,
          });
        return false;
      }
      const key = node.attrs.uploadKey as string | null;
      const state = stateOf(key);
      const name = manager?.get(key)?.file.name ?? (node.attrs.name as string | undefined) ?? t('media.image.label');
      if (state === 'failed')
        problems.push({
          code: 'media.failed',
          message: t('media.problem.failed', { name }),
          severity: 'error',
          nodeId,
        });
      else if (state === 'uploading')
        problems.push({
          code: 'media.uploading',
          message: t('media.problem.uploading', { name }),
          severity: 'error',
          nodeId,
        });
      return false;
    });
    return problems;
  },
});

/**
 * Shift-paste (Mod-Shift-V) pastes plain text, as it does everywhere else in the editor, even when the clipboard also
 * holds files: an office app puts a picture of the selection next to its text. It runs before the file handler.
 */
function plainPastePlugin(): Plugin {
  let shift = false;
  const track = (_view: unknown, event: KeyboardEvent) => {
    shift = event.shiftKey;
    return false;
  };
  return new Plugin({
    key: new PluginKey('postCanvasPlainPaste'),
    props: {
      handleDOMEvents: { keydown: track, keyup: track, blur: () => ((shift = false), false) },
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!shift || !data || data.files.length === 0) return false;
        const text = data.getData('text/plain');
        if (!text) return false;
        // Without the original event, so neither this plugin nor the file handler sees its files again.
        view.pasteText(text);
        return true;
      },
    },
  });
}

/** The editor media extensions for a feature set, with node views, commands, paste and drop, and insert items. */
export function mediaKit(features: Features): AnyExtension[] {
  const extensions: AnyExtension[] = [];
  if (features.image) {
    const captionMarks = captionMarksFor(features);
    extensions.push(
      createImageNode(captionMarks).extend({
        parseHTML() {
          // Assigned, not spread: spreading would read the lazy `baseUrl` now.
          return imageParseRules(Object.assign(editorSourceOptions(this.editor), { captionMarks }));
        },
        addNodeView() {
          return ReactNodeViewRenderer(ImageNodeView, {
            className: 'pc-node pc-node--image',
            attrs: ({ node }) => ({ 'data-pc-align': String(node.attrs.align) }),
            // Everything in the caption editor, drags and drops included, belongs to the caption's own editor.
            stopEvent: ({ event }) => inCaptionEditor(event) || mediaStopEvent(event),
          });
        },
        postCanvasInsert() {
          const { t } = this.editor.storage.postCanvasCore;
          return [
            {
              id: 'image',
              group: 'media',
              label: t('media.insert.image'),
              description: t('media.insert.imageHint'),
              keywords: t('media.insert.imageKeywords')
                .split(/[\s,]+/)
                .filter(Boolean),
              icon: ImageIcon,
              run: ({ editor, range }) => insertFrom(editor, range, 'image'),
            } satisfies InsertItem,
          ];
        },
      }),
    );
  }
  if (features.gallery) {
    const limits = galleryLimitsFrom(features.gallery);
    extensions.push(
      createGalleryNode(limits).extend({
        parseHTML() {
          return galleryParseRules(editorSourceOptions(this.editor), limits);
        },
        addNodeView() {
          return ReactNodeViewRenderer(GalleryNodeView, {
            className: 'pc-node pc-node--gallery',
            stopEvent: ({ event }) => mediaStopEvent(event, true),
          });
        },
        postCanvasInsert() {
          const { t } = this.editor.storage.postCanvasCore;
          return [
            {
              id: 'gallery',
              group: 'media',
              label: t('media.insert.gallery'),
              description: t('media.insert.galleryHint'),
              keywords: t('media.insert.galleryKeywords')
                .split(/[\s,]+/)
                .filter(Boolean),
              icon: Images,
              run: ({ editor, range }) => insertFrom(editor, range, 'gallery'),
            } satisfies InsertItem,
          ];
        },
      }),
    );
  }
  if (features.file) {
    extensions.push(
      FileNode.extend({
        parseHTML() {
          return fileParseRules(editorSourceOptions(this.editor));
        },
        addNodeView() {
          return ReactNodeViewRenderer(FileNodeView, {
            className: 'pc-node pc-node--file',
            stopEvent: ({ event }) => mediaStopEvent(event),
          });
        },
        postCanvasInsert() {
          const { t } = this.editor.storage.postCanvasCore;
          return [
            {
              id: 'file',
              group: 'media',
              label: t('media.insert.file'),
              description: t('media.insert.fileHint'),
              keywords: t('media.insert.fileKeywords')
                .split(/[\s,]+/)
                .filter(Boolean),
              icon: Paperclip,
              run: ({ editor, range }) => insertFrom(editor, range, 'file'),
            } satisfies InsertItem,
          ];
        },
      }),
    );
  }
  if (features.image || features.gallery || features.file) extensions.push(MediaUploads);
  return extensions;
}
