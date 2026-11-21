import { Extension, type Editor } from '@tiptap/core';
import en from '../locales/en/index';
import { defaultFeatures } from './features';
import { createTranslator } from './i18n';
import type { Adapters, Features, NotifyKind, PostCanvasCoreStorage, Translator } from './types';
import './extension-fields';

/** Options of the `postCanvasCore` extension. */
export interface PostCanvasCoreOptions {
  /** Defaults to English. */
  t: Translator;
  adapters: Adapters;
  /** The resolved features. Defaults to `defaultFeatures`. */
  features: Features;
  /** Called for every notice. Defaults to the console. The UI replaces it with a live region and toasts. */
  notify: (message: string, kind?: NotifyKind) => void;
  /**
   * An absolute http(s) URL that relative picture addresses in loaded HTML resolve against (`/images/a.jpg` becomes
   * `https://example.com/images/a.jpg`). Default `null`: relative pictures are dropped, since a document only stores
   * absolute sources.
   */
  baseUrl: string | null;
}

function consoleNotify(message: string, kind: NotifyKind = 'info'): void {
  if (kind === 'error') console.error(`[post-canvas] ${message}`);
  else console.info(`[post-canvas] ${message}`);
}

/**
 * The extension every Post Canvas editor starts with. It holds the translator, the adapters, the resolved features and
 * `notify()` in `editor.storage.postCanvasCore`, where any extension can read them. `PostCanvas` keeps them current
 * when its props change.
 */
export const PostCanvasCore = Extension.create<PostCanvasCoreOptions, PostCanvasCoreStorage>({
  name: 'postCanvasCore',

  addOptions() {
    return {
      t: createTranslator(en),
      adapters: {},
      features: defaultFeatures,
      notify: consoleNotify,
      baseUrl: null,
    };
  },

  addStorage() {
    return {
      t: this.options.t,
      adapters: this.options.adapters,
      features: this.options.features,
      notify: this.options.notify,
      baseUrl: this.options.baseUrl,
    };
  },
});

/**
 * Updates the shared state in `editor.storage.postCanvasCore`, for example when `PostCanvas`'s props change. Extensions
 * read the storage when they run, so they see the new values on their next call.
 */
export function updatePostCanvasCore(editor: Editor, values: Partial<PostCanvasCoreStorage>): void {
  Object.assign(editor.storage.postCanvasCore, values);
}
