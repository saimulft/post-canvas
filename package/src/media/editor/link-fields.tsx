'use client';
import { useId, useState, type SyntheticEvent } from 'react';
import type { Translator } from '../../core/types';
import { normalizeLinkInput } from '../../ui/link-popover';

/** Props of `LinkFields`. */
export interface LinkFieldsProps {
  /** The current address, empty for none. */
  href: string;
  /** Whether the link opens a new tab now. */
  newTab: boolean;
  /** Called with a safe href (a bare domain gets `https://`) and the target. */
  onApply: (href: string, target: '_blank' | null) => void;
  /** Shown as "Remove link" when the thing already links somewhere. */
  onRemove?: () => void;
  t: Translator;
}

/** The link form used for a picture and for caption text: the address, "open in a new tab", apply and remove. */
export function LinkFields({ href, newTab: startNewTab, onApply, onRemove, t }: LinkFieldsProps) {
  const id = useId();
  const [value, setValue] = useState(href);
  const [newTab, setNewTab] = useState(startNewTab);
  const [error, setError] = useState(false);

  function apply(event: SyntheticEvent) {
    event.preventDefault();
    // Stops the submit reaching a form the editor sits in.
    event.stopPropagation();
    const safe = normalizeLinkInput(value);
    if (!safe) {
      setError(true);
      return;
    }
    onApply(safe, newTab ? '_blank' : null);
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
        {onRemove && href && (
          <button type="button" className="pc-button pc-button--quiet" onClick={onRemove}>
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
