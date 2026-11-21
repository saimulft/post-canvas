import { describe, expect, it } from 'vitest';
import { resolveMediaSrc, safeHref, safeHttpUrl, safeMediaSrc } from './url';

const char = (code: number) => String.fromCharCode(code);
const TAB = char(9);
const NEWLINE = char(10);
const NUL = char(0);
const ESC = char(27);
const NBSP = char(160);

describe('safeHref', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    '  javascript:alert(1)',
    `${TAB}javascript:alert(1)`,
    `${NEWLINE}javascript:alert(1)`,
    `${NBSP}javascript:alert(1)`,
    `java${TAB}script:alert(1)`,
    `java${NEWLINE}script:alert(1)`,
    `java${NUL}script:alert(1)`,
    `${ESC}javascript:alert(1)`,
    'jav&#x09;ascript:alert(1)',
    '&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert(1)',
    '&#x6A;avascript:alert(1)',
    '&#106avascript:alert(1)',
    'javascript&colon;alert(1)',
    '&amp;#106;avascript:alert(1)',
    '%6A%61%76%61%73%63%72%69%70%74:alert(1)',
    'javascript%3Aalert(1)',
    '%256Aavascript:alert(1)',
    'vbscript:msgbox(1)',
    'VBScript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'DATA:image/svg+xml,<svg onload=alert(1)>',
    'file:///etc/passwd',
    'about:blank',
    '//evil.com',
    '//evil.com/path',
    `${TAB}//evil.com`,
    '\\\\evil.com',
    '/\\evil.com',
    '',
    '   ',
  ])('blocks %j', (url) => {
    expect(safeHref(url)).toBeNull();
  });

  it('blocks values that are not strings', () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(42)).toBeNull();
    expect(safeHref({ href: 'https://example.com' })).toBeNull();
  });

  it.each([
    ['https://example.com', 'https://example.com'],
    ['http://example.com/a?b=c#d', 'http://example.com/a?b=c#d'],
    ['HTTPS://Example.com', 'HTTPS://Example.com'],
    ['  https://example.com  ', 'https://example.com'],
    [`https://exa${TAB}mple.com`, 'https://example.com'],
  ])('allows %j', (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });

  it.each(['/about', 'about', './about', '../up/one', '#section', '?q=1', 'page.html', 'a/b:c'])(
    'allows the relative path %j',
    (url) => {
      // "a/b:c" has a colon only after a slash, so it is a path, not a scheme.
      expect(safeHref(url)).toBe(url);
    },
  );

  it.each(['mailto:someone@example.com', 'MAILTO:someone@example.com?subject=Hi', 'tel:+15555550123', 'tel:555-0123'])(
    'allows %j',
    (url) => {
      expect(safeHref(url)).toBe(url);
    },
  );
});

describe('safeHttpUrl', () => {
  it('returns normalised http and https URLs', () => {
    expect(safeHttpUrl('https://example.com')).toBe('https://example.com/');
    expect(safeHttpUrl('  HTTP://EXAMPLE.com/a b ')).toBe('http://example.com/a%20b');
  });

  it.each(['/relative', 'example.com', '//evil.com', 'mailto:a@b.c', 'tel:1', 'javascript:alert(1)', 'ftp://x.y'])(
    'rejects %j',
    (url) => {
      expect(safeHttpUrl(url)).toBeNull();
    },
  );
});

describe('safeMediaSrc', () => {
  it('allows http and https only', () => {
    expect(safeMediaSrc('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(safeMediaSrc('data:image/png;base64,AAAA')).toBeNull();
    expect(safeMediaSrc('/uploads/a.jpg')).toBeNull();
    expect(safeMediaSrc('javascript:alert(1)')).toBeNull();
  });

  it('allows blob: URLs only when asked', () => {
    const blob = 'blob:http://localhost:5100/2b1c1f0e-1d7c-4a7e-9d0e-6a5f2b9c1a11';
    expect(safeMediaSrc(blob)).toBeNull();
    expect(safeMediaSrc(blob, { allowBlob: true })).toBe(blob);
    expect(safeMediaSrc('blob:javascript:alert(1)', { allowBlob: true })).toBeNull();
  });
});

describe('resolveMediaSrc', () => {
  it('resolves relative addresses against an http(s) base', () => {
    expect(resolveMediaSrc('/images/a.jpg', 'https://example.com/blog/post')).toBe('https://example.com/images/a.jpg');
    expect(resolveMediaSrc('a.jpg', 'https://example.com/blog/')).toBe('https://example.com/blog/a.jpg');
    expect(resolveMediaSrc('//cdn.example.com/a.jpg', 'https://example.com')).toBe('https://cdn.example.com/a.jpg');
  });

  it('refuses addresses with a scheme of their own, and bases that are not http(s)', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:x', 'java\tscript:x', '&#106;avascript:x', 'data:image/png;base64,AA']) {
      expect(resolveMediaSrc(url, 'https://example.com')).toBeNull();
    }
    expect(resolveMediaSrc('https://cdn.example.com/a.jpg', 'https://example.com')).toBeNull();
    expect(resolveMediaSrc('/a.jpg', 'javascript:alert(1)//')).toBeNull();
    expect(resolveMediaSrc('/a.jpg', '/relative-base')).toBeNull();
    expect(resolveMediaSrc('/a.jpg', null)).toBeNull();
  });
});
