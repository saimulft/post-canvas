'use client';
// The title and cover fields above the canvas.
import type { Editor } from '@tiptap/core';
import { useId, type Ref } from 'react';
import type { CoverImage, PostFields, Translator } from '../core/types';
import { CoverField } from '../media/cover/cover-field';

/** The longest title, in characters. */
export const titleMaxLength = 200;

/** Props of `TitleField`. */
export interface TitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  editor: Editor | null;
  t: Translator;
  /** Shows "Articles need a title." under it. */
  missing?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
}

/**
 * A title that grows with its text (the CSS grid trick: an invisible copy sets the height, so nothing is measured).
 * Line breaks become spaces, and Enter or ArrowDown at the end moves the caret into the body.
 */
export function TitleField({ value, onChange, editor, t, missing = false, inputRef }: TitleFieldProps) {
  const id = useId();
  const near = value.length > titleMaxLength - 30;
  return (
    <div className="pc-title">
      <div className="pc-title__grow">
        <div className="pc-title__mirror" aria-hidden="true">
          {value === '' ? t('ui.title.placeholder') : `${value}\u200b`}
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          className="pc-title__input"
          value={value}
          maxLength={titleMaxLength}
          placeholder={t('ui.title.placeholder')}
          aria-label={t('ui.title.label')}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${id}-error` : near ? `${id}-count` : undefined}
          onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, ' ').slice(0, titleMaxLength))}
          onKeyDown={(event) => {
            const atEnd = event.currentTarget.selectionStart === event.currentTarget.value.length;
            if (event.key === 'Enter' || (event.key === 'ArrowDown' && atEnd)) {
              event.preventDefault();
              editor?.commands.focus('start');
            }
          }}
        />
      </div>
      {(missing || near) && (
        <div className="pc-title__meta">
          {missing ? (
            <p id={`${id}-error`} className="pc-field-error" role="alert">
              {t('text.problem.title')}
            </p>
          ) : (
            <span />
          )}
          {near && (
            <span id={`${id}-count`} className="pc-title__count">
              {t('ui.title.count', { count: value.length, max: titleMaxLength })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Props of `Fields`. */
export interface FieldsProps {
  fields: PostFields;
  onChange: (fields: PostFields) => void;
  editor: Editor | null;
  t: Translator;
  showTitle: boolean;
  showCover: boolean;
  titleMissing: boolean;
  readOnly: boolean;
}

/** The title and cover. In read-only mode, only a title that has text, as a heading. */
export function Fields({ fields, onChange, editor, t, showTitle, showCover, titleMissing, readOnly }: FieldsProps) {
  if (readOnly) {
    return showTitle && fields.title ? <h1 className="pc-title pc-title--static">{fields.title}</h1> : null;
  }
  if (!showTitle && !showCover) return null;
  return (
    <div className="pc-fields">
      {showCover && (
        <CoverField
          value={fields.cover ?? null}
          onChange={(cover: CoverImage | null) => onChange({ ...fields, cover })}
        />
      )}
      {showTitle && (
        <TitleField
          value={fields.title ?? ''}
          onChange={(title) => onChange({ ...fields, title })}
          editor={editor}
          t={t}
          missing={titleMissing}
        />
      )}
    </div>
  );
}
