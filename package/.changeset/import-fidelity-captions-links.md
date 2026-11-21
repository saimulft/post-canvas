---
'post-canvas': minor
---

Imported HTML keeps more of a post. Image captions can hold links, bold, italic and the other text marks, edited in place under the picture, and a picture can link somewhere (a Link button in its toolbar). `fromHTML()` and the editor also keep links around inline code, named link targets such as `target="new"` (as a new tab), heading `id`s and header-cell `scope`s, and `renderToHTML()` and `PostCanvasView` put a table's header rows in `<thead>`. Relative picture addresses resolve against the new `baseUrl` option instead of being dropped.
