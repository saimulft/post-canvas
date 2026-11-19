# post-canvas

## 0.1.2

### Patch Changes

- 3e5b096: The base photo of a collage now gets full-width `sizes`, so browsers load a large enough image.
- 00f04fb: `excerpt()` now stays within `max` characters including the ellipsis, and no longer cuts an emoji in half.
- daf64fd: File sizes just under a unit boundary now read "1 MB" instead of "1024 KB".
- 4bb7540: The link popover now accepts a bare domain with a port, such as `example.com:8080/path`.
- c8e8ca5: A paragraph line of only `-` or `=` no longer turns into a horizontal rule or a heading in Markdown output.
- 77deb6c: A heading that ends in ` #` keeps the `#` in Markdown output.
- 160804d: `toMarkdown` now writes italic as `*text*`, so italic inside a word, like `foo*bar*baz`, isn't lost.
- 36ff505: `toMarkdown` no longer breaks a table when a cell holds a `|`, and a line break inside a table cell now becomes `<br>` instead of a stray backslash.
- ebf9249: Cutting a mention's id or label to 200 characters no longer splits an emoji into an invalid character.
- 458e3b1: Pasting plain text with several blank lines that hold spaces no longer adds a stray space and line break.
- 188ac62: Screen readers now announce the missing-title error, like the other form errors.

## 0.1.1

### Patch Changes

- 6137169: Photos after the first in a gallery no longer sit lower than the first, and galleries and the photo manager no longer pick up the indent and markers of text lists.
- 6137169: The README is now a visual tour: a screenshot of every feature (rich text and menus, mentions, the four gallery layouts and the collage editor, embeds and link cards, presets, HTML output and the sanitizer), each with a link to try it live. The package `homepage` now points at the website, https://postcanvas.saimulislam.com, and the description and keywords are updated.

## 0.1.0

### Minor Changes

- e1dfeda: First release. A React editor built on Tiptap 3 for posts and articles: rich text, photo galleries (carousel, grid,
  masonry and collage), image and file uploads through your own adapter, video and social embeds, link cards, mentions and
  hashtags, autosave, four presets, and six languages. Documents render to HTML, React, Markdown and text on the server
  with a built-in sanitizer, and a vanilla build runs the editor from a CDN without React.
