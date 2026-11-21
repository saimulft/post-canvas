// The `post-canvas` entry. Shared file: each chat edits only its own marked section.

// --- chat 0: core ---
export * from './core/types';
export { defaultFeatures, resolveFeatures, builtInEmbedProviderNames } from './core/features';
export { createTranslator } from './core/i18n';
export { safeHref, safeHttpUrl, safeMediaSrc, resolveMediaSrc } from './core/url';
export { createId, createKey } from './core/ids';
export { collectInsertItems, collectProblems } from './core/registry';
export {
  PostCanvasProvider,
  usePostCanvasContext,
  useOptionalPostCanvasContext,
  type PostCanvasContextValue,
} from './core/react/context';
export { useTranslator } from './core/react/use-translator';
export { MediaFrame, type MediaFrameProps, type FrameHandle, type FrameKey } from './core/react/media-frame';
export { MediaToolbar, type MediaToolbarProps } from './core/react/media-toolbar';
export { ToolButton, type ToolButtonProps } from './core/react/tool-button';
export { Popover, type PopoverProps } from './core/react/popover';
export {
  usePointerDrag,
  type DragCallbacks,
  type PointerDragOptions,
  type PointerDragHandlers,
} from './core/react/use-pointer-drag';
export { default as en } from './locales/en/index';
// --- end chat 0 ---

// --- chat A: media ---
export { hasPendingUploads } from './media/upload/pending';
export { CoverField, type CoverFieldProps } from './media/cover/cover-field';
export { imageAccept, openFilePicker, type FilePickerOptions } from './media/upload/picker';
export type { UploadTarget } from './media/upload/pipeline';
export type { InsertGalleryOptions, InsertImageOptions } from './media/kit';
// --- end chat A ---

// --- chat B: text and UI ---
export {
  PostCanvas,
  type PostCanvasProps,
  type PostCanvasTheme,
  type PostCanvasHandle,
  type PostCanvasSlots,
} from './react/post-canvas';
export {
  usePostCanvasEditor,
  type UsePostCanvasEditorOptions,
  type PostCanvasEditorState,
  type PostCanvasChange,
  type ContentFormat,
} from './react/use-post-canvas-editor';
export { presets, type PresetDefinition } from './text/presets';
export {
  getDocStats,
  countWords,
  countCharacters,
  readMinutes,
  wordsPerMinute,
  type DocStats,
  type MediaCounts,
} from './text/stats';
export { getProblems } from './text/problems';
export { limitProblems, isInsertCapped, maxMentions, type Limits } from './text/limits';
export {
  socialClassifier,
  articleClassifier,
  classifySocial,
  socialKind,
  articleReason,
  kindSummary,
  postMaxWords,
  type Classifier,
  type Classification,
  type ClassifyInput,
  type SocialKind,
} from './text/classify';
export {
  createAutosave,
  localDraftStorage,
  storableContent,
  hasDraftContent,
  type AutosaveOptions,
  type AutosaveController,
} from './text/autosave';
export { cleanPastedHTML } from './text/paste';
// --- end chat B ---

// --- chat C: output and embeds ---
export { hasTransientContent } from './output/text';
export {
  defineEmbedProvider,
  registerEmbedProvider,
  getEmbedProvider,
  listEmbedProviders,
  matchEmbedUrl,
  parseEmbedUrl,
  parseVideoUrl,
  canonicalVideoUrl,
  builtInProviders,
  type EmbedFrame,
  type EmbedMatch,
  type EmbedProvider,
  type EmbedRef,
  type VideoProvider,
  type VideoRef,
} from './embeds/providers/index';
export type { EmbedConsent, EmbedsKitOptions } from './embeds/kit';
export type { EmbedInputKind } from './embeds/editor/actions';
export type { EmbedRenderMode } from './embeds/render-spec';
// --- end chat C ---
