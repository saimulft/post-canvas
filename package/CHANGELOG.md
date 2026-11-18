# post-canvas

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
