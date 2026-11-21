// Imported HTML keeps what other editors and CMSs put in posts: links around pictures and in captions, links around
// inline code, table head rows, header scopes, heading anchors and pictures with relative addresses.
import { Window } from 'happy-dom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JSONContent } from '../core/types';
import { fromHTML, type HTMLParserHost } from './from-html';
import { renderToHTML } from './html';
import { toMarkdown } from './markdown';
import { PostCanvasView } from './react-view';
import { sanitizeDocument } from './sanitize';

const window = new Window() as unknown as HTMLParserHost;
const roundTrip = (html: string, options: { baseUrl?: string } = {}) =>
  renderToHTML(fromHTML(html, { window, ...options }), { wrapper: false });
const first = (doc: JSONContent) => doc.content?.[0];

describe('pictures', () => {
  it('keeps the link around a picture, in a figure and on its own', () => {
    const inFigure = roundTrip(
      '<figure><a href="https://shop.example.com" target="_blank" rel="noopener"><img src="https://cdn.example.com/a.png" alt="Shop"></a><figcaption>The shop</figcaption></figure>',
    );
    expect(inFigure).toContain('<a class="pc-image__link" href="https://shop.example.com" target="_blank"');
    expect(inFigure).toMatch(/<a class="pc-image__link"[^>]*><img [^>]*src="https:\/\/cdn\.example\.com\/a\.png"/);
    const bare = fromHTML('<p><a href="/pricing"><img src="https://cdn.example.com/b.png" alt=""></a></p>', { window });
    expect(bare.content?.find((node) => node.type === 'image')?.attrs?.link).toEqual({
      href: '/pricing',
      target: null,
      rel: null,
    });
  });

  it('leaves a link that wraps text as well as a picture on the text', () => {
    const doc = fromHTML(
      '<p><a href="https://example.com"><img src="https://cdn.example.com/a.png"> Read more</a></p>',
      {
        window,
      },
    );
    expect(doc.content?.find((node) => node.type === 'image')?.attrs?.link).toBeNull();
    expect(renderToHTML(doc, { wrapper: false })).toContain('<a href="https://example.com">');
  });

  it('drops an unsafe picture link and keeps the picture', () => {
    const html = roundTrip(
      '<figure><a href="javascript:alert(1)"><img src="https://cdn.example.com/a.png"></a></figure>',
    );
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).not.toContain('javascript:');
    const doc = sanitizeDocument({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/a.png', link: { href: 'data:text/html,x' } } }],
    }).doc;
    expect(first(doc)?.attrs?.link).toBeNull();
  });

  it('keeps links, bold and line breaks in a caption', () => {
    const html = roundTrip(
      '<figure><img src="https://cdn.example.com/a.png" alt="Plans"><figcaption>Check the <em>current</em> plans on <a href="https://wordpress.com/pricing/" target="_blank" rel="noopener noreferrer">WordPress.com</a>.<br>Photo: <strong>us</strong></figcaption></figure>',
    );
    expect(html).toContain(
      '<figcaption class="pc-image__caption">Check the <em>current</em> plans on <a href="https://wordpress.com/pricing/" target="_blank" rel="noopener noreferrer">WordPress.com</a>.<br/>Photo: <strong>us</strong></figcaption>',
    );
  });

  it('keeps one link open across a caption formatted inside it', () => {
    const html = roundTrip(
      '<figure><img src="https://cdn.example.com/a.png"><figcaption><a href="https://example.com">Photo <em>via</em> us</a></figcaption></figure>',
    );
    expect(html).toContain('<a href="https://example.com">Photo <em>via</em> us</a>');
  });

  it('drops an unsafe link in a caption and keeps its text', () => {
    const html = roundTrip(
      '<figure><img src="https://cdn.example.com/a.png"><figcaption>See <a href="javascript:alert(1)">this</a></figcaption></figure>',
    );
    expect(html).toContain('<figcaption class="pc-image__caption">See this</figcaption>');
    const doc = sanitizeDocument({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'https://cdn.example.com/a.png',
            captionContent: [
              { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
              { type: 'text', text: 'y', marks: [{ type: 'script' }] },
              { type: 'paragraph', content: [] },
            ],
          },
        },
      ],
    }).doc;
    expect(first(doc)?.attrs).toMatchObject({ caption: 'xy', captionContent: null });
  });

  it('keeps plain captions plain, so older documents render as before', () => {
    const legacy = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/a.png', caption: 'A plain caption' } }],
    };
    const doc = sanitizeDocument(legacy).doc;
    expect(first(doc)?.attrs).toMatchObject({ caption: 'A plain caption', captionContent: null, link: null });
    expect(renderToHTML(doc, { wrapper: false })).toContain(
      '<figcaption class="pc-image__caption">A plain caption</figcaption>',
    );
  });

  it('writes picture links and caption links to Markdown', () => {
    const doc = fromHTML(
      '<figure><a href="https://shop.example.com"><img src="https://cdn.example.com/a.png" alt="Shop"></a><figcaption>Via <a href="https://example.com">us</a></figcaption></figure>',
      { window },
    );
    expect(toMarkdown(doc)).toContain(
      '[![Shop](https://cdn.example.com/a.png)](https://shop.example.com)\n_Via [us](https://example.com)_',
    );
  });

  it('resolves relative picture addresses against baseUrl, and drops them without one', () => {
    const html = '<p>Hi</p><img src="/images/a.jpg" alt="A" srcset="/images/a-640.jpg 640w, /images/a-1280.jpg 1280w">';
    const resolved = fromHTML(html, { window, baseUrl: 'https://hypential.com' });
    expect(resolved.content?.find((node) => node.type === 'image')?.attrs).toMatchObject({
      src: 'https://hypential.com/images/a.jpg',
      srcset: 'https://hypential.com/images/a-640.jpg 640w, https://hypential.com/images/a-1280.jpg 1280w',
    });
    const removed: string[] = [];
    const dropped = fromHTML(html, { window, onRemoved: (items) => removed.push(...items.map((item) => item.path)) });
    expect(dropped.content?.some((node) => node.type === 'image')).toBe(false);
    expect(removed).toContain('html:img[0]');
  });

  it('never resolves a dangerous address as if it were relative', () => {
    for (const src of [
      'javascript:alert(1)',
      'java&#x09;script:alert(1)',
      'data:image/svg+xml,<svg>',
      'file:///etc/x',
    ]) {
      const doc = fromHTML(`<img src="${src}">`, { window, baseUrl: 'https://example.com' });
      expect(doc.content?.some((node) => node.type === 'image')).toBe(false);
    }
    // A protocol-relative address names its own host: it gets the base's protocol, like any absolute picture.
    const cdn = fromHTML('<img src="//cdn.example.com/a.jpg">', { window, baseUrl: 'https://example.com' });
    expect(cdn.content?.find((node) => node.type === 'image')?.attrs?.src).toBe('https://cdn.example.com/a.jpg');
    // The base itself must be http(s).
    const noBase = fromHTML('<img src="/a.jpg">', { window, baseUrl: 'javascript:alert(1)//' });
    expect(noBase.content?.some((node) => node.type === 'image')).toBe(false);
  });
});

describe('text', () => {
  it('reads a named link target as a new tab, and _self or _top as none', () => {
    const html = roundTrip(
      '<p><a href="https://a.example.com" target="new">A</a> <a href="https://b.example.com" target="_self">B</a> <a href="https://c.example.com" target="_top">C</a></p>',
    );
    expect(html).toContain('<a href="https://a.example.com" target="_blank" rel="noopener noreferrer nofollow">A</a>');
    expect(html).toContain('<a href="https://b.example.com">B</a>');
    expect(html).toContain('<a href="https://c.example.com">C</a>');
  });

  it('keeps a link around inline code, and bold around it', () => {
    const html = roundTrip(
      '<p>Run <a href="https://www.postgresql.org/docs/18/app-pgchecksums.html"><code>pg_checksums --enable</code></a> or <strong><code>on</code></strong>.</p>',
    );
    expect(html).toContain(
      '<a href="https://www.postgresql.org/docs/18/app-pgchecksums.html"><code>pg_checksums --enable</code></a>',
    );
    expect(html).toContain('<strong><code>on</code></strong>');
  });

  it('keeps heading anchor ids, refuses unsafe ones and keeps the first of duplicates', () => {
    const html = roundTrip(
      '<h2 id="-why-it-matters">Why</h2><h2 id="“the-model”">Model</h2><h3 id="a b">Bad</h3><h3 id=\'x"onmouseover=alert(1)\'>Worse</h3><h2 id="-why-it-matters">Again</h2>',
    );
    expect(html).toContain('<h2 id="-why-it-matters">Why</h2>');
    expect(html).toContain('<h2 id="“the-model”">Model</h2>');
    expect(html).toContain('<h3>Bad</h3>');
    expect(html).toContain('<h3>Worse</h3>');
    expect(html).toContain('<h2>Again</h2>');
    expect(html).not.toContain('onmouseover');
  });

  it("puts a table's header rows in thead and keeps header scopes", () => {
    const html = roundTrip(
      '<table><thead><tr><th scope="col">Plan</th><th scope="col">Price</th></tr></thead><tbody><tr><th scope="row">Pro</th><td>$9</td></tr></tbody></table>',
    );
    expect(html).toMatch(
      /<table[^>]*><colgroup>.*<\/colgroup><thead><tr><th scope="col">.*Plan.*<\/th><th scope="col">.*<\/thead><tbody><tr><th scope="row">.*Pro.*<\/tbody><\/table>/,
    );
    const view = renderToStaticMarkup(
      createElement(PostCanvasView, {
        content: fromHTML('<table><tr><th>Plan</th></tr><tr><td>Pro</td></tr></table>', { window }),
      }),
    );
    expect(view).toMatch(/<thead><tr><th[^>]*>.*Plan.*<\/thead><tbody><tr><td[^>]*>.*Pro.*<\/tbody>/);
    expect(roundTrip('<table><tr><td>a</td></tr></table>')).not.toContain('<thead>');
    expect(roundTrip('<table><tr><th scope="evil">a</th></tr><tr><td>b</td></tr></table>')).not.toContain('evil');
  });
});
