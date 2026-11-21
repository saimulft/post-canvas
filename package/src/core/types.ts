// Every type shared across the package's areas. The contract for these lives in the plan; change them only in
// backward-compatible ways.
import type { Editor, JSONContent, Range } from '@tiptap/core';
import type { ComponentType, ReactNode } from 'react';
import './extension-fields';

export type { JSONContent };

// ---------------------------------------------------------------------------------------------------------------------
// Document model: text
// ---------------------------------------------------------------------------------------------------------------------

/** Horizontal alignment of a paragraph or heading. `null` means the default (start). */
export type TextAlign = 'left' | 'center' | 'right' | 'justify' | null;

/**
 * A named colour from the theme palette. Text colour and highlight store the name, never a hex value, so themes and
 * dark mode recolour it and nothing unsafe reaches a `style` attribute.
 */
export type PaletteColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

/** Every palette colour name, in menu order. */
export const paletteColors: readonly PaletteColor[] = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

// ---------------------------------------------------------------------------------------------------------------------
// Document model: media
// ---------------------------------------------------------------------------------------------------------------------

/** An uploaded picture, shared by the image node, gallery photos and the cover. */
export interface MediaSource {
  /** An https URL from the upload adapter. A `blob:` URL only while the upload runs. */
  src: string;
  /** Intrinsic width in pixels. `0` means unknown: the editor measures the picture when it loads. */
  width: number;
  /** Intrinsic height in pixels. `0` means unknown. */
  height: number;
  /** Alternative text. Empty for decorative pictures. */
  alt: string;
  /** A validated `srcset` such as `"url 640w, url 1280w"`, or `null`. */
  srcset: string | null;
  /** A tiny `data:image/(jpeg|png|webp);base64` preview of at most 2 KB, or `null`. */
  placeholder: string | null;
  /** The upload adapter's id, for the app's own bookkeeping. */
  uploadId: string | null;
  /** Transient: set while an upload runs or after it failed, `null` once it's done. Never saved. */
  uploadKey: string | null;
}

/** How a gallery lays out its photos. */
export type GalleryLayout = 'carousel' | 'grid' | 'masonry' | 'collage';

/** Every gallery layout, in menu order. */
export const galleryLayouts: readonly GalleryLayout[] = ['carousel', 'grid', 'masonry', 'collage'];

/** Where a single image sits in the column. */
export type ImageAlign = 'center' | 'wide' | 'full' | 'left' | 'right';

/** Where a collage photo sits on the base photo. */
export interface CollagePlace {
  /** Centre x, from 0 to 1 of the base. */
  x: number;
  /** Centre y, from 0 to 1 of the base. */
  y: number;
  /** Width as a fraction of the base, from 0.08 to 1. */
  w: number;
  /** Rotation in degrees, from -180 to 180, rounded to 0.1. */
  r: number;
}

/** One photo in a gallery. */
export interface GalleryPhoto extends MediaSource {
  /** Stable per photo, for React keys and reordering. */
  key: string;
  /** Collage position. `null` for the base photo and for every other layout. */
  place: CollagePlace | null;
}

/** Attributes of the `image` block node. */
export interface ImageAttrs extends MediaSource {
  /** Unique within the document. Filled in by the editor; `null` after sanitizing a node that had none. */
  id: string;
  /** Plain text shown under the picture. Empty for none. */
  caption: string;
  /** Where the picture sits: in the column, wider than it, the full width, or floated left or right. */
  align: ImageAlign;
}

/** Attributes of the `gallery` block node. */
export interface GalleryAttrs {
  /** Unique within the document. Filled in by the editor. */
  id: string;
  /** How the photos are laid out. A collage with fewer than 2 photos shows as a carousel. */
  layout: GalleryLayout;
  /** From 1 to the feature's `maxPhotos`. */
  photos: GalleryPhoto[];
  /** Plain text shown under the gallery. Empty for none. */
  caption: string;
}

/** Attributes of the `file` block node. */
export interface FileAttrs {
  /** Unique within the document. Filled in by the editor. */
  id: string;
  /** The download URL from the upload adapter. A `blob:` URL only while the upload runs. */
  src: string;
  /** The file name shown on the card. */
  name: string;
  /** Size in bytes, or `null` when unknown. */
  size: number | null;
  /** The MIME type, such as `application/pdf`, or `null` when unknown. */
  mimeType: string | null;
  /** The upload adapter's id, for the app's own bookkeeping. */
  uploadId: string | null;
  /** Transient: set while an upload runs or after it failed, `null` once it's done. Never saved. */
  uploadKey: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Document model: embeds
// ---------------------------------------------------------------------------------------------------------------------

/** Attributes of the `video` block node. Player URLs are built at render time, never stored. */
export interface VideoAttrs {
  /** Unique within the document. Filled in by the editor. */
  id: string;
  /** Where the video lives. */
  provider: 'youtube' | 'vimeo';
  /** The provider's video id, validated against its format. */
  videoId: string;
  /** The privacy hash of an unlisted Vimeo video. */
  hash: string | null;
  /** A vertical video, such as a YouTube Short. */
  vertical: boolean;
  /** Start time in seconds. */
  start: number | null;
  /** The video's title, shown on the facade and used as the player's accessible name. */
  title: string;
  /** A short description, from the metadata resolver or the writer. */
  description: string;
  /** An https poster image for the facade, or `null` for the provider's default. */
  thumbnailUrl: string | null;
}

/** Attributes of the `embed` block node. The iframe URL is built from `provider` and `ref` at render time. */
export interface EmbedAttrs {
  /** Unique within the document. Filled in by the editor. */
  id: string;
  /** A registered provider name. */
  provider: string;
  /** Validated ids only. */
  ref: Record<string, string>;
  /** The canonical page URL. */
  url: string;
  /** The embed's title, used as the frame's accessible name. */
  title: string;
  /** Width divided by height, or `null` for the provider's default size. */
  aspectRatio: number | null;
}

/** Attributes of the `linkCard` block node. */
export interface LinkCardAttrs {
  /** Unique within the document. Filled in by the editor. */
  id: string;
  /** The linked page, an http or https URL. */
  url: string;
  /** The page's title. */
  title: string;
  /** A short summary of the page. Empty for none. */
  description: string;
  /** An https preview image, or `null`. */
  image: string | null;
  /** The site's name, such as "The Example Times", or `null`. */
  siteName: string | null;
  /** An https icon for the site, or `null`. */
  favicon: string | null;
}

/** Attributes of the transient `embedInput` node: the inline "paste a link" field. Never saved. */
export interface EmbedInputAttrs {
  /** Unique within the document while it exists. */
  id: string;
  /** What the writer typed or pasted so far. */
  value: string;
  /** `loading` while a pasted link is being looked up, `error` when it couldn't become a block. */
  status: 'idle' | 'loading' | 'error';
  /** The translated message shown under the field when `status` is `error`, else `null`. */
  error: string | null;
  /** What the link may become: anything, or only a video, an embed or a link card. */
  kind: 'any' | 'video' | 'embed' | 'link';
}

// ---------------------------------------------------------------------------------------------------------------------
// Post fields
// ---------------------------------------------------------------------------------------------------------------------

/** A post's cover picture. */
export type CoverImage = Omit<MediaSource, 'uploadKey'>;

/** Optional fields outside the body, shown above the canvas by some presets. */
export interface PostFields {
  /** At most 200 characters. */
  title?: string;
  /** The cover picture, or `null` when it was removed. */
  cover?: CoverImage | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Features and presets
// ---------------------------------------------------------------------------------------------------------------------

/** A heading level the editor offers. */
export type HeadingLevel = 1 | 2 | 3 | 4;

/** Which parts of the editor are on. `resolveFeatures()` builds a complete set from a preset and overrides. */
export interface Features {
  // Text
  /** Bold text (Mod-B). */
  bold: boolean;
  /** Italic text (Mod-I). */
  italic: boolean;
  /** Underlined text (Mod-U). */
  underline: boolean;
  /** Struck-through text (Mod-Shift-S). */
  strike: boolean;
  /** Inline code (Mod-E). */
  code: boolean;
  /** Links (Mod-K). Only safe URLs are kept. */
  link: boolean;
  /** Highlighting in a palette colour. */
  highlight: boolean;
  /** Text colour from the palette. */
  color: boolean;
  /** Subscript text. */
  subscript: boolean;
  /** Superscript text. */
  superscript: boolean;
  /** Left, centre, right and justified paragraphs and headings. */
  textAlign: boolean;
  /** Headings, with the levels on offer, or `false` for none. Default levels 1 to 4. */
  heading: false | { levels: HeadingLevel[] };
  /** Bulleted lists. */
  bulletList: boolean;
  /** Numbered lists. */
  orderedList: boolean;
  /** Checklists. */
  taskList: boolean;
  /** Block quotes. */
  blockquote: boolean;
  /** Code blocks with syntax highlighting. */
  codeBlock: boolean;
  /** Dividers. */
  horizontalRule: boolean;
  /** Tables with header rows and resizable columns. */
  table: boolean;
  /** `@` mentions, from `adapters.mentions`. */
  mention: boolean;
  /** `#` hashtags, from `adapters.hashtags`. */
  hashtag: boolean;
  // Media
  /** Single pictures. Needs `adapters.upload` unless set explicitly. */
  image: boolean;
  /** Photo galleries, with the layouts on offer and the most photos. Default: all four layouts, at most 10 photos. */
  gallery: false | { layouts: GalleryLayout[]; maxPhotos: number };
  /** File attachments. Needs `adapters.upload` unless set explicitly. */
  file: boolean;
  // Embeds
  /** YouTube and Vimeo videos. */
  video: boolean;
  /** Embeds from the named providers, or `false` for none. Default: every built-in provider. */
  embed: false | { providers: string[] };
  /** Link cards with a preview, from `adapters.links`. */
  linkCard: boolean;
  // UI
  /** The toolbar above the canvas. */
  toolbar: boolean;
  /** The menu over selected text. */
  bubbleMenu: boolean;
  /** The `/` menu. */
  slashMenu: boolean;
  /** The **+** button beside empty lines. */
  insertButton: boolean;
  /** The handle beside each block, to drag it and open its menu. */
  blockHandle: boolean;
  /** The status bar: counts, the post kind and problems. */
  statusBar: boolean;
  // Fields
  /** The title field above the canvas. */
  title: boolean;
  /** The cover picture field above the canvas. */
  cover: boolean;
}

/** A named starting set of features. */
export type PresetName = 'full' | 'article' | 'social' | 'comment';

/** A partial set of features that replaces the matching keys of a preset. */
export type FeatureOverrides = { [K in keyof Features]?: Features[K] };

// ---------------------------------------------------------------------------------------------------------------------
// Adapters: how the editor talks to the app
// ---------------------------------------------------------------------------------------------------------------------

/** What the app's upload adapter returns for one file. */
export interface UploadResult {
  /** The final https URL. */
  src: string;
  /** Your storage's id for the file. Stored as `uploadId`. */
  id?: string;
  /** Intrinsic width in pixels. Default: measured in the browser before the upload. */
  width?: number;
  /** Intrinsic height in pixels. Default: measured in the browser before the upload. */
  height?: number;
  /** Resized copies, such as `"https://cdn.example/a-640.jpg 640w, https://cdn.example/a-1280.jpg 1280w"`. */
  srcset?: string;
  /** A tiny `data:image/(jpeg|png|webp);base64` preview of at most 2 KB, shown while the picture loads. */
  placeholder?: string;
  /** The stored file name, for file cards. Default: the picked file's name. */
  name?: string;
  /** The stored size in bytes. Default: the picked file's size. */
  size?: number;
  /** The stored MIME type. Default: the picked file's type. */
  mimeType?: string;
}

/** Context passed to every upload. */
export interface UploadContext {
  /** `image` for pictures (single, gallery and cover), `file` for attachments. */
  kind: 'image' | 'file';
  /** Aborted when the user cancels or removes the block. */
  signal: AbortSignal;
  /** Report progress from 0 to 1. */
  onProgress: (fraction: number) => void;
}

/** Uploads files to the app's storage. Without one, image, gallery and file are off unless set explicitly. */
export interface UploadAdapter {
  /** Uploads one file and resolves with its final URL. Reject to show the upload as failed, with a retry. */
  upload(file: File, ctx: UploadContext): Promise<UploadResult>;
  /** `accept` strings for the file inputs. */
  accept?: { image?: string; file?: string };
  /** Size limits in bytes. */
  maxBytes?: { image?: number; file?: number };
  /** Optional HEIC to JPEG conversion, with a library the app installs itself. */
  convertHeic?: (file: File) => Promise<Blob>;
}

/** One person or tag in a suggestion list. */
export interface SuggestionItem {
  /**
   * Your id for the person or tag. Stored on the mention node, as any string up to 200 characters. Every output
   * escapes it, but validate it before you build a profile URL from it.
   */
  id: string;
  /** What the mention shows, without the `@` or `#`. */
  label: string;
  /** A second line in the list, such as a handle or a count. */
  description?: string;
  /** An https picture shown in the list. */
  avatarUrl?: string;
}

/** Looks up mentions (`@`) or hashtags (`#`). */
export interface SuggestionSource {
  /** Finds matches for what follows the `@` or `#`. The signal aborts when the query changes or the list closes. */
  search(query: string, ctx: { signal: AbortSignal }): Promise<SuggestionItem[]>;
}

/** Metadata the app's server found for an embed. */
export interface EmbedMetadata {
  /** The video's or embed's title. */
  title?: string;
  /** A short description. Videos only. */
  description?: string;
  /** An https poster image. Videos only. */
  thumbnailUrl?: string;
  /** Width divided by height. Embeds only. */
  aspectRatio?: number;
}

/** Looks up an embed's title, description and thumbnail, usually through the app's server. */
export type EmbedMetadataResolver = (url: string, ctx: { signal: AbortSignal }) => Promise<EmbedMetadata>;

/** A link card's preview. */
export interface LinkPreview {
  /** The final page URL, after redirects. */
  url: string;
  /** The page's title. */
  title: string;
  /** A short summary, such as the page's `og:description`. */
  description?: string;
  /** An https preview image, such as the page's `og:image`. */
  image?: string;
  /** The site's name, such as the page's `og:site_name`. */
  siteName?: string;
  /** An https icon for the site. */
  favicon?: string;
}

/** Fetches a link card's preview, usually through the app's server. */
export type LinkPreviewResolver = (url: string, ctx: { signal: AbortSignal }) => Promise<LinkPreview>;

/** An autosaved draft. */
export interface DraftSnapshot {
  /** The document, without uploads in flight or local previews. */
  content: JSONContent;
  /** The title and cover, when the preset shows them. */
  fields?: PostFields;
  /** ISO 8601 time. */
  savedAt: string;
}

/** Where autosaved drafts live. The default is `localStorage` in a try/catch. */
export interface DraftStorage {
  /** The draft saved under `key`, or `null`. A failure counts as no draft. */
  load(key: string): DraftSnapshot | null | Promise<DraftSnapshot | null>;
  /** Saves the draft under `key`. A failure is logged and the draft just isn't kept. */
  save(key: string, snapshot: DraftSnapshot): void | Promise<void>;
  /** Forgets the draft under `key`. */
  clear(key: string): void | Promise<void>;
}

/** Everything the app plugs into the editor. All optional. */
export interface Adapters {
  upload?: UploadAdapter;
  /** `@` mentions. */
  mentions?: SuggestionSource;
  /** `#` hashtags. */
  hashtags?: SuggestionSource;
  /** Titles and thumbnails for videos and embeds, usually through your server (`createEmbedResolver`). */
  embeds?: EmbedMetadataResolver;
  /** Link card previews, through your server (`createLinkPreviewResolver`). Without it, pasted links stay links. */
  links?: LinkPreviewResolver;
  /** Where autosave keeps drafts. Default: `localStorage`. */
  storage?: DraftStorage;
}

// ---------------------------------------------------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------------------------------------------------

/** Values for a message's placeholders. */
export type TranslateValues = Record<string, string | number>;

/** Looks up a message by its dotted key, such as `core.frame.remove`, and fills in its placeholders. */
export type Translator = (key: string, values?: TranslateValues) => string;

/** A language: its BCP 47 code and its flat, dotted messages. */
export interface Locale {
  /** A BCP 47 code, such as `en` or `pt-BR`. Used for plurals and number formats. */
  code: string;
  /** Messages by dotted key, such as `ui.toolbar.bold`. Missing keys fall back to English. */
  messages: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The core extension
// ---------------------------------------------------------------------------------------------------------------------

/** How a notice is announced. */
export type NotifyKind = 'info' | 'error';

/** What every extension reads through `editor.storage.postCanvasCore`. */
export interface PostCanvasCoreStorage {
  /** The editor's translator. */
  t: Translator;
  /** The app's adapters. */
  adapters: Adapters;
  /** The resolved features. */
  features: Features;
  /** Announces a message in the editor's live region (and as a toast, once the UI wires it). */
  notify(message: string, kind?: NotifyKind): void;
  /** Where relative picture addresses in loaded HTML resolve, or `null` to drop them. */
  baseUrl: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Insert items and problems (extension fields)
// ---------------------------------------------------------------------------------------------------------------------

/** Where an insert item appears in the `+` and `/` menus. */
export type InsertGroup = 'basic' | 'lists' | 'media' | 'embeds' | 'advanced';

/** Where an insert item was chosen from. */
export type InsertSource = 'slash' | 'insert-button' | 'toolbar';

/** One entry in the `+` and `/` menus. Extensions provide these through `postCanvasInsert`. */
export interface InsertItem {
  /** Stable id, such as `heading-2`, `table` or `gallery`. */
  id: string;
  /** The menu section it appears in. */
  group: InsertGroup;
  /** Already translated. */
  label: string;
  /** A second line in the menu, already translated. */
  description?: string;
  /** Extra search words. */
  keywords: string[];
  /** A lucide-react icon. */
  icon: ComponentType<{ size?: number }>;
  /** Inserts the block. Delete `ctx.range` first when it's given: it's the `/` and the query typed after it. */
  run(ctx: { editor: Editor; range?: Range; source: InsertSource }): void;
}

/** Something that blocks or warns before publishing. Extensions provide these through `postCanvasProblems`. */
export interface Problem {
  /** A stable code, such as `title.missing`, `limit.words` or `media.uploading`. */
  code: string;
  /** Already translated. */
  message: string;
  /** `error` blocks publishing; `warning` only informs. */
  severity: 'error' | 'warning';
  /** The node it's about, if any. */
  nodeId?: string;
}

/** Cleans one node's or mark's attributes. Returns `null` to drop it. Pure, so it runs on the server too. */
export type AttrsSanitizer = (attrs: Record<string, unknown>) => Record<string, unknown> | null;

// ---------------------------------------------------------------------------------------------------------------------
// Read-only views
// ---------------------------------------------------------------------------------------------------------------------

/** Props of a read-only view for one node type. */
export interface ViewProps {
  /** The node to show, with sanitized attributes. */
  node: { type: string; attrs: Record<string, unknown> };
  /** The view's translator. */
  t: Translator;
}

/** Renders one node type in the read-only `PostCanvasView`. */
export type ViewComponent = (props: ViewProps) => ReactNode;

/** Read-only views by node type. */
export type ViewMap = Partial<Record<string, ViewComponent>>;
