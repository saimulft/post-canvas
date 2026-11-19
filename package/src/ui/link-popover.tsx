'use client';
// Adding, editing, opening and removing links: the link form, and the small bar shown while the caret is in a link.
import type { ReferenceElement } from '@floating-ui/dom';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { ExternalLink, Pencil, Unlink } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';
import { Popover } from '../core/react/popover';
import { safeHref } from '../core/url';
import { TbButton } from './controls';
import { useEditorUi } from './ui-context';

/** Turns what someone typed into a safe href: adds `https://` to a bare domain and `mailto:` to an address. */
export function normalizeLinkInput(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return safeHref(`mailto:${value}`);
  // "example.com:8080/path" looks like a scheme to the check below, so treat a domain with a port as a bare domain.
  if (/^[^\s/:@]+\.[^\s/:@]+:\d{1,5}(?:[/?#]|$)/.test(value)) return safeHref(`https://${value}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) {
    return safeHref(value);
  }
  if (/^[^\s/]+\.[^\s/]{2,}/.test(value)) return safeHref(`https://${value}`);
  return null;
}

/** A virtual element at the current selection, for anchoring popovers to text. */
export function selectionAnchor(editor: Editor): ReferenceElement {
  return {
    getBoundingClientRect: () => {
      const { from, to } = editor.state.selection;
      return posToDOMRect(editor.view, from, to);
    },
    contextElement: editor.view.dom,
  };
}

/** Props of `LinkPopover`. */
export interface LinkPopoverProps {
  open: boolean;
  anchor: ReferenceElement | null;
  onClose: () => void;
}

/** The link form: the address, "open in a new tab", apply and remove. */
export function LinkPopover({ open, anchor, onClose }: LinkPopoverProps) {
  const { editor, t } = useEditorUi();
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} label={t('ui.link.dialog')} className="pc-link-popover">
      {open && <LinkForm editor={editor} onClose={onClose} />}
    </Popover>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useEditorUi();
  const id = useId();
  const existing = editor.getAttributes('link') as { href?: string; target?: string | null };
  const [value, setValue] = useState(existing.href ?? '');
  const [newTab, setNewTab] = useState(existing.target === '_blank');
  const [error, setError] = useState(false);

  function apply(event: SyntheticEvent) {
    event.preventDefault();
    const href = normalizeLinkInput(value);
    if (!href) {
      setError(true);
      return;
    }
    const target = newTab ? '_blank' : null;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: insert the address as the link text.
      chain
        .insertContent({ type: 'text', text: value.trim(), marks: [{ type: 'link', attrs: { href, target } }] })
        .run();
    } else {
      chain.setLink({ href, target }).run();
    }
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  }

  return (
    <form className="pc-link-form" onSubmit={apply} noValidate>
      <label className="pc-field-label" htmlFor={`${id}-url`}>
        {t('ui.link.address')}
      </label>
      <input
        id={`${id}-url`}
        className="pc-input"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://"
        value={value}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(false);
        }}
      />
      {error && (
        <p id={`${id}-error`} className="pc-field-error" role="alert">
          {t('ui.link.invalid')}
        </p>
      )}
      <label className="pc-check">
        <input type="checkbox" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} />
        {t('ui.link.newTab')}
      </label>
      <div className="pc-form-actions">
        {existing.href && (
          <button type="button" className="pc-button pc-button--quiet" onClick={remove}>
            {t('ui.link.remove')}
          </button>
        )}
        <button type="submit" className="pc-button pc-button--primary">
          {t('ui.link.apply')}
        </button>
      </div>
    </form>
  );
}

/** The bar shown while the caret sits in a link: the address, open, edit and remove. */
export function LinkBubble() {
  const { editor, t, openLink } = useEditorUi();
  const href = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e.isActive('link') ? ((e.getAttributes('link').href as string | undefined) ?? '') : '',
  });
  const safe = safeHref(href);
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="postCanvasLinkBubble"
      shouldShow={({ editor: e, state }) => e.isEditable && state.selection.empty && e.isActive('link')}
      options={{ placement: 'bottom-start', offset: 6 }}
      className="pc-bubble pc-link-bubble"
      role="toolbar"
      aria-label={t('ui.link.bar')}
    >
      <span className="pc-link-bubble__href" title={href}>
        {href}
      </span>
      {safe && (
        <a
          className="pc-tb-button"
          href={safe}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={t('ui.link.open')}
          title={t('ui.link.open')}
          data-roving=""
        >
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      )}
      <TbButton icon={Pencil} label={t('ui.link.edit')} onClick={(button) => openLink(button)} />
      <TbButton
        icon={Unlink}
        label={t('ui.link.remove')}
        onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
      />
    </BubbleMenu>
  );
}
