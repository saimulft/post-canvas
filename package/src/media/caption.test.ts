import { describe, expect, it } from 'vitest';
import { captionChildrenSpec, captionFields, captionText, sanitizeCaptionContent } from './caption';

describe('sanitizeCaptionContent', () => {
  it('keeps text, allowed marks and line breaks, and joins neighbours with the same marks', () => {
    const content = sanitizeCaptionContent([
      { type: 'text', text: 'Photo ', marks: [{ type: 'italic' }] },
      { type: 'text', text: 'via', marks: [{ type: 'italic' }, { type: 'italic' }] },
      { type: 'hardBreak' },
      { type: 'hardBreak' },
      { type: 'text', text: 'us', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }] },
      { type: 'hardBreak' },
    ]);
    expect(content).toEqual([
      { type: 'text', text: 'Photo via', marks: [{ type: 'italic' }] },
      { type: 'hardBreak' },
      {
        type: 'text',
        text: 'us',
        marks: [
          {
            type: 'link',
            attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer nofollow' },
          },
        ],
      },
    ]);
  });

  it('drops marks the features leave out, unknown pieces and controls', () => {
    const content = sanitizeCaptionContent(
      [
        { type: 'text', text: 'a\u0000b\u202ec', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: '/x' } }] },
        { type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } },
        'not a node',
      ],
      ['bold'],
    );
    expect(content).toEqual([{ type: 'text', text: 'a b c', marks: [{ type: 'bold' }] }]);
  });

  it('caps the text at 1,000 characters and the line breaks at 20', () => {
    const long = sanitizeCaptionContent([{ type: 'text', text: 'x'.repeat(5000) }]);
    expect(captionText(long)).toHaveLength(1000);
    const breaks = sanitizeCaptionContent(
      Array.from({ length: 60 }, (_, index) => (index % 2 ? { type: 'hardBreak' } : { type: 'text', text: 'a' })),
    );
    expect(breaks.filter((node) => node.type === 'hardBreak')).toHaveLength(20);
  });

  it('reads a plain string, with its newlines as line breaks', () => {
    expect(sanitizeCaptionContent('one\ntwo')).toEqual([
      { type: 'text', text: 'one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'two' },
    ]);
  });
});

describe('captionFields', () => {
  it('prefers the formatted caption and rebuilds the plain text from it', () => {
    expect(captionFields('stale text', [{ type: 'text', text: 'Fresh', marks: [{ type: 'bold' }] }])).toEqual({
      caption: 'Fresh',
      captionContent: [{ type: 'text', text: 'Fresh', marks: [{ type: 'bold' }] }],
    });
    expect(captionFields('Plain', null)).toEqual({ caption: 'Plain', captionContent: null });
  });
});

describe('captionChildrenSpec', () => {
  it('nests marks in a fixed order and never treats the text "br" as a line break', () => {
    expect(
      captionChildrenSpec([
        { type: 'text', text: 'br' },
        { type: 'hardBreak' },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: '/a' } }] },
      ]),
    ).toEqual(['br', ['br'], ['a', { href: '/a' }, ['strong', {}, 'b']]]);
  });
});
