'use client';
// The caption under a picture, edited in place with its own small editor: bold, italic, links and the other caption
// marks, and Shift-Enter line breaks. The picture stays one block in the document, so selecting, moving and deleting
// it work as before; only the caption's text is rich.
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import Underline from '@tiptap/extension-underline';
import { CharacterCount, Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Bold as BoldIcon, Italic as ItalicIcon, Link2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Popover } from '../../core/react/popover';
import type { CaptionContent, CaptionMark, Translator } from '../../core/types';
import { linkRel } from '../../text/sanitize';
import { PcCode, PcLink } from '../../text/schema';
import { sanitizeCaptionContent } from '../caption';
import { textLimits } from '../rules';
import { LinkFields } from './link-fields';

/** Props of `CaptionEditor`. */
export interface CaptionEditorProps {
  /** The caption, as formatted pieces. */
  value: CaptionContent;
  /** Called with the cleaned caption after each change. */
  onChange: (value: CaptionContent) => void;
  /** Enter (without Shift) leaves the caption, to the text after the block. */
  onLeave: () => void;
  /** The marks the caption may use. */
  marks: readonly CaptionMark[];
  label: string;
  placeholder: string;
  t: Translator;
  className?: string;
}

/** The caption as the small editor's document: one paragraph. */
function toDoc(value: CaptionContent): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', ...(value.length > 0 ? { content: value } : {}) }] };
}

/** The small editor's document as a caption: paragraphs (from a paste) are joined with line breaks. */
function fromDoc(doc: JSONContent, marks: readonly CaptionMark[]): CaptionContent {
  const pieces: unknown[] = [];
  (doc.content ?? []).forEach((paragraph, index) => {
    if (index > 0) pieces.push({ type: 'hardBreak' });
    pieces.push(...(paragraph.content ?? []));
  });
  return sanitizeCaptionContent(pieces, marks);
}

const toolIcons: Partial<Record<CaptionMark, LucideIcon>> = { bold: BoldIcon, italic: ItalicIcon, link: Link2 };

/** The caption editor: a single paragraph that grows with its text, with formatting buttons while it has focus. */
export function CaptionEditor({
  value,
  onChange,
  onLeave,
  marks,
  label,
  placeholder,
  t,
  className,
}: CaptionEditorProps) {
  const [focused, setFocused] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  // The latest callbacks, read by the editor's handlers without rebuilding it, and the last caption sent.
  const latest = useRef({ onChange, onLeave, marks, openLink: () => setLinkOpen(true) });
  useEffect(() => {
    latest.current = { onChange, onLeave, marks, openLink: () => setLinkOpen(true) };
  });
  const sent = useRef(JSON.stringify(value));

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      CharacterCount.configure({ limit: textLimits.caption }),
      Placeholder.configure({ placeholder }),
      ...(marks.includes('bold') ? [Bold] : []),
      ...(marks.includes('italic') ? [Italic] : []),
      ...(marks.includes('underline') ? [Underline] : []),
      ...(marks.includes('strike') ? [Strike] : []),
      ...(marks.includes('code') ? [PcCode] : []),
      ...(marks.includes('link') ? [PcLink] : []),
      Extension.create({
        name: 'postCanvasCaptionKeys',
        addKeyboardShortcuts() {
          return {
            Enter: () => {
              latest.current.onLeave();
              return true;
            },
            Escape: ({ editor: e }) => {
              e.view.dom.blur();
              return true;
            },
            'Mod-k': () => {
              if (!latest.current.marks.includes('link')) return false;
              latest.current.openLink();
              return true;
            },
          };
        },
      }),
    ],
    content: toDoc(value),
    editorProps: {
      attributes: {
        class: 'pc-caption-editor__input',
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'false',
      },
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor: e }) => {
      const next = fromDoc(e.getJSON(), latest.current.marks);
      const key = JSON.stringify(next);
      if (key === sent.current) return;
      sent.current = key;
      latest.current.onChange(next);
    },
  });

  // A caption changed from outside (undo in the document, a restore) replaces the editor's copy. While someone types,
  // the value coming back is the one just sent, so nothing is reset under the caret.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const key = JSON.stringify(value);
    if (key === sent.current) return;
    sent.current = key;
    editor.commands.setContent(toDoc(value), { emitUpdate: false });
  }, [editor, value]);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? { bold: e.isActive('bold'), italic: e.isActive('italic'), link: e.isActive('link') }
        : { bold: false, italic: false, link: false },
  });

  const tools = (['bold', 'italic', 'link'] as const).filter((mark) => marks.includes(mark));
  const showTools = editor && (focused || linkOpen) && tools.length > 0;

  return (
    <div ref={setBox} className={['pc-caption-editor', className].filter(Boolean).join(' ')} data-pc-stop="">
      <EditorContent editor={editor} />
      {showTools && (
        <div className="pc-caption-tools" role="toolbar" aria-label={t('media.caption.tools')} contentEditable={false}>
          {tools.map((mark) => {
            const Icon = toolIcons[mark] ?? Link2;
            const name = mark === 'link' ? t('ui.link.button') : t(`ui.mark.${mark}`);
            return (
              <button
                key={mark}
                type="button"
                className="pc-tool-button pc-caption-tools__button"
                aria-label={name}
                title={name}
                aria-pressed={active?.[mark] ?? false}
                // Keeps the caret in the caption.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (mark === 'link') setLinkOpen(true);
                  else editor.chain().focus().toggleMark(mark).run();
                }}
              >
                <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      {editor && (
        <Popover
          open={linkOpen}
          anchor={box}
          onClose={() => setLinkOpen(false)}
          label={t('ui.link.dialog')}
          placement="bottom"
          className="pc-link-popover"
        >
          {linkOpen && <CaptionLinkForm editor={editor} t={t} onDone={() => setLinkOpen(false)} />}
        </Popover>
      )}
    </div>
  );
}

/** The link form for the caption's selected text, or for the link the caret is in. */
function CaptionLinkForm({ editor, t, onDone }: { editor: Editor; t: Translator; onDone: () => void }) {
  const existing = editor.getAttributes('link') as { href?: string; target?: string | null };
  return (
    <LinkFields
      href={existing.href ?? ''}
      newTab={existing.target === '_blank'}
      t={t}
      onApply={(href, target) => {
        const attrs = { href, target, rel: linkRel(null, target) };
        const chain = editor.chain().focus().extendMarkRange('link');
        if (editor.state.selection.empty && !editor.isActive('link')) {
          // Nothing selected: the address becomes the link's text.
          chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs }] }).run();
        } else {
          chain.setMark('link', attrs).run();
        }
        onDone();
      }}
      onRemove={() => {
        editor.chain().focus().extendMarkRange('link').unsetMark('link').run();
        onDone();
      }}
    />
  );
}
