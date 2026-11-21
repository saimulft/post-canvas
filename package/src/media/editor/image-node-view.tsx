'use client';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  ImageUp,
  Link2,
  PanelLeft,
  PanelRight,
  RectangleHorizontal,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { MediaFrame } from '../../core/react/media-frame';
import { MediaToolbar } from '../../core/react/media-toolbar';
import { Popover } from '../../core/react/popover';
import { ToolButton } from '../../core/react/tool-button';
import { useTranslator } from '../../core/react/use-translator';
import { captionMarks as allCaptionMarks, type CaptionContent, type CaptionMark, type ImageAlign } from '../../core/types';
import { captionText, isFormattedCaption, sanitizeCaptionContent } from '../caption';
import { imageAttrsOf } from '../coerce';
import { imageCaptionChildren, imgAttrs } from '../html';
import { textLimits } from '../rules';
import { sanitizeImageLink } from '../sanitize';
import { imageAccept, openFilePicker } from '../upload/picker';
import { uploadFiles } from '../upload/pipeline';
import { specToReact } from '../view/spec-to-react';
import { CaptionEditor } from './caption-editor';
import { LinkFields } from './link-fields';
import { RadioMenu } from './radio-menu';
import { runFrameKey, useEditable } from '../../core/react/node-view';
import { useUpload } from './node-view-utils';
import { UploadStatus, uploadView } from './upload-status';

const alignIcons: Record<ImageAlign, LucideIcon> = {
  center: AlignCenter,
  wide: RectangleHorizontal,
  full: AlignHorizontalJustifyCenter,
  left: PanelLeft,
  right: PanelRight,
};
const alignOrder: ImageAlign[] = ['center', 'wide', 'full', 'left', 'right'];

/** The `image` block in the editor: the picture, its caption, and tools to replace, describe, align and remove it. */
export function ImageNodeView({
  editor,
  extension,
  node,
  getPos,
  selected,
  updateAttributes,
  deleteNode,
}: ReactNodeViewProps) {
  const t = useTranslator();
  const attrs = imageAttrsOf(node.attrs);
  const entry = useUpload(editor, attrs.uploadKey);
  const editable = useEditable(editor);
  const [panel, setPanel] = useState<'alt' | 'align' | 'link' | null>(null);
  const [altAnchor, setAltAnchor] = useState<HTMLElement | null>(null);
  const [alignAnchor, setAlignAnchor] = useState<HTMLElement | null>(null);
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const captionMarks: readonly CaptionMark[] =
    (extension.options as { captionMarks?: readonly CaptionMark[] }).captionMarks ?? allCaptionMarks;
  const caption = sanitizeCaptionContent(attrs.captionContent ?? attrs.caption, captionMarks);
  const setCaption = (content: CaptionContent) =>
    updateAttributes({
      caption: captionText(content),
      captionContent: isFormattedCaption(content) ? content : null,
    });
  const manager = editor.storage.postCanvasMedia?.manager ?? null;
  const view = uploadView(attrs.uploadKey, entry);
  const label = attrs.alt ? t('media.image.labelWithAlt', { alt: attrs.alt }) : t('media.image.label');

  const replace = () => {
    const accept = imageAccept(editor.storage.postCanvasCore.adapters.upload?.accept?.image);
    void openFilePicker({ accept }).then((files) => {
      if (files.length > 0 && attrs.id) void uploadFiles(editor, files, { type: 'replace', nodeId: attrs.id });
    });
  };

  // A pasted picture without a size gets it once it loads, outside the undo history.
  const measure = (image: HTMLImageElement) => {
    if (attrs.width > 0 && attrs.height > 0) return;
    const pos = getPos();
    if (typeof pos !== 'number' || !image.naturalWidth || !image.naturalHeight) return;
    editor.view.dispatch(
      editor.state.tr
        .setNodeAttribute(pos, 'width', image.naturalWidth)
        .setNodeAttribute(pos, 'height', image.naturalHeight)
        .setMeta('addToHistory', false),
    );
  };

  const img = imgAttrs(attrs, { className: 'pc-image__img' });
  const toolbar = editable ? (
    <MediaToolbar label={t('core.frame.tools', { label })}>
      <ToolButton icon={ImageUp} label={t('media.image.replace')} onClick={replace} />
      <span ref={setAltAnchor} className="pc-media-anchor">
        <ToolButton
          icon={TextCursorInput}
          label={t('media.image.alt')}
          pressed={panel === 'alt'}
          onClick={() => setPanel(panel === 'alt' ? null : 'alt')}
        />
      </span>
      <span ref={setAlignAnchor} className="pc-media-anchor">
        <ToolButton
          icon={alignIcons[attrs.align]}
          label={t('media.image.align')}
          pressed={panel === 'align'}
          onClick={() => setPanel(panel === 'align' ? null : 'align')}
        />
      </span>
      <span ref={setLinkAnchor} className="pc-media-anchor">
        <ToolButton
          icon={Link2}
          label={attrs.link ? t('ui.link.edit') : t('ui.link.button')}
          pressed={panel === 'link' || Boolean(attrs.link)}
          onClick={() => setPanel(panel === 'link' ? null : 'link')}
        />
      </span>
      <ToolButton icon={Trash2} label={t('media.image.remove')} onClick={deleteNode} />
    </MediaToolbar>
  ) : undefined;

  return (
    <NodeViewWrapper className="pc-node-view">
      <MediaFrame
        label={label}
        selected={selected}
        onKey={(key) => runFrameKey(editor, getPos, key)}
        onRemove={deleteNode}
        toolbar={toolbar}
        className="pc-frame--image"
      >
        <figure className={`pc-image pc-image--${attrs.align}`} data-align={attrs.align}>
          <span className="pc-image__media">
            <img
              className={img.class}
              src={img.src}
              alt={img.alt}
              width={img.width}
              height={img.height}
              srcSet={img.srcset}
              sizes={img.sizes}
              decoding="async"
              draggable={false}
              onLoad={(event) => measure(event.currentTarget)}
            />
            <UploadStatus
              view={view}
              t={t}
              onRetry={() => attrs.uploadKey && manager?.start(attrs.uploadKey)}
              onReplace={editable ? replace : undefined}
            />
          </span>
          {editable ? (
            <CaptionEditor
              value={caption}
              onChange={setCaption}
              onLeave={() => runFrameKey(editor, getPos, 'after')}
              marks={captionMarks}
              label={t('media.caption.label')}
              placeholder={t('media.caption.placeholder')}
              t={t}
              className="pc-image__caption"
            />
          ) : (
            caption.length > 0 &&
            specToReact([
              'figcaption',
              { class: 'pc-image__caption' },
              ...imageCaptionChildren({ caption: attrs.caption, captionContent: attrs.captionContent }),
            ])
          )}
        </figure>
      </MediaFrame>
      <Popover
        open={panel === 'alt'}
        anchor={altAnchor}
        onClose={() => setPanel(null)}
        label={t('media.alt.title')}
        placement="bottom-end"
        className="pc-media-panel"
      >
        <AltTextForm
          value={attrs.alt}
          onChange={(alt) => updateAttributes({ alt })}
          onDone={() => setPanel(null)}
          t={t}
        />
      </Popover>
      <Popover
        open={panel === 'link'}
        anchor={linkAnchor}
        onClose={() => setPanel(null)}
        label={t('ui.link.dialog')}
        placement="bottom-end"
        className="pc-media-panel pc-link-popover"
      >
        {panel === 'link' && (
          <LinkFields
            href={attrs.link?.href ?? ''}
            newTab={attrs.link?.target === '_blank'}
            t={t}
            onApply={(href, target) => {
              updateAttributes({ link: sanitizeImageLink({ href, target }) });
              setPanel(null);
            }}
            onRemove={() => {
              updateAttributes({ link: null });
              setPanel(null);
            }}
          />
        )}
      </Popover>
      <Popover
        open={panel === 'align'}
        anchor={alignAnchor}
        onClose={() => setPanel(null)}
        label={t('media.image.align')}
        role="menu"
        placement="bottom-end"
        className="pc-menu"
      >
        <RadioMenu
          value={attrs.align}
          options={alignOrder.map((align) => ({
            value: align,
            label: t(`media.align.${align}`),
            icon: alignIcons[align],
          }))}
          onSelect={(align) => {
            setPanel(null);
            updateAttributes({ align });
          }}
        />
      </Popover>
    </NodeViewWrapper>
  );
}

/** Props of `AltTextForm`. */
export interface AltTextFormProps {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Default: the image wording. */
  label?: string;
}

/** The alt text field with its hint. Enter or Done closes it. */
export function AltTextForm({ value, onChange, onDone, t, label }: AltTextFormProps) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="pc-alt-form">
      <label className="pc-media-field">
        <span className="pc-media-field__label">{label ?? t('media.alt.title')}</span>
        <textarea
          className="pc-media-input pc-media-input--area"
          rows={3}
          value={draft}
          maxLength={textLimits.alt}
          placeholder={t('media.alt.placeholder')}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onDone();
            }
          }}
        />
      </label>
      <p className="pc-media-field__hint">{t('media.alt.hint')}</p>
      <div className="pc-media-panel__actions">
        <button type="button" className="pc-media-button pc-media-button--primary" onClick={onDone}>
          {t('media.done')}
        </button>
      </div>
    </div>
  );
}
