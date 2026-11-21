// The `post-canvas/extensions` entry. Shared file: each chat edits only its own marked section.

// --- chat 0: core ---
export { PostCanvasCore, updatePostCanvasCore, type PostCanvasCoreOptions } from './core/extension';
export { postCanvasKit, idNodeTypes, type PostCanvasKitOptions } from './core/kit';
export { postCanvasSchema } from './core/schema';
export { sanitizersFor } from './core/registry';
// --- end chat 0 ---

// --- chat A: media ---
export {
  ImageNode,
  GalleryNode,
  FileNode,
  createImageNode,
  createGalleryNode,
  mediaSchema,
  type GalleryNodeOptions,
  type ImageNodeOptions,
} from './media/schema';
export { mediaKit, MediaUploads } from './media/kit';
export {
  sanitizeImageAttrs,
  sanitizeImageLink,
  sanitizeGalleryAttrs,
  sanitizeFileAttrs,
  type GalleryLimits,
} from './media/sanitize';
export { sanitizeCaptionContent, captionText } from './media/caption';
// --- end chat A ---

// --- chat B: text and UI ---
export { textSchema, textExtensions, mentionText } from './text/schema';
export {
  PcParagraph,
  PcHeading,
  PcCode,
  PcOrderedList,
  PcTaskItem,
  PcTableCell,
  PcTableHeader,
  PcCodeBlock,
  PcLink,
  PcTextStyle,
  PcHighlight,
  PcMention,
} from './text/schema';
export { textKit, PostCanvasText, countMentions, type PostCanvasTextStorage } from './text/kit';
export { PasteCleanup, cleanPastedHTML, plainTextSlice } from './text/paste';
export { CodeHighlight, codeLanguages, loadLowlight, resolveCodeLanguage } from './text/code-highlight';
export { textInsertItems, filterInsertItems } from './text/insert-items';
export {
  moveBlock,
  duplicateBlock,
  deleteBlock,
  turnInto,
  turnIntoTargets,
  canMoveBlock,
  type TurnIntoTarget,
} from './text/block-commands';
export * from './text/sanitize';
export type { MenuStore, SuggestionState, SuggestionEntry, SuggestionKind } from './text/menu-store';
// --- end chat B ---

// --- chat C: output and embeds ---
export {
  Video,
  Embed,
  LinkCard,
  EmbedInput,
  createEmbedNode,
  embedsSchema,
  type EmbedNodeOptions,
} from './embeds/schema';
export { embedsKit, EmbedPaste, type EmbedConsent, type EmbedsKitOptions } from './embeds/kit';
export { setEmbedConsent } from './embeds/editor/storage';
export { defineEmbedProvider, registerEmbedProvider, builtInProviders } from './embeds/providers/index';
// --- end chat C ---
