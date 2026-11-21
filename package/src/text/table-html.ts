// Tables in the rendered output: leading header rows go in `<thead>` and the rest in `<tbody>`, as most imported
// tables had them. The schema's own `renderHTML` (used by the editor and the clipboard) keeps Tiptap's single `<tbody>`,
// because a node spec has one content hole. Render-safe: no React and no DOM.
import { createColGroup } from '@tiptap/extension-table';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';

/** Tiptap's default minimum column width, which the schema's table uses. */
const cellMinWidth = 25;

/** How many leading rows hold only header cells. At least one row is left for the body. */
export function tableHeadRows(table: PMNode): number {
  let count = 0;
  for (let index = 0; index < table.childCount - 1; index++) {
    const row = table.child(index);
    let headerOnly = row.childCount > 0;
    row.forEach((cell) => {
      if (cell.type.name !== 'tableHeader') headerOnly = false;
    });
    if (!headerOnly) break;
    count++;
  }
  return count;
}

/** The `<table>` element with its width style and `<colgroup>`, as the schema renders it, without the rows. */
export function tableShellSpec(table: PMNode): DOMOutputSpec {
  const { colgroup, tableWidth, tableMinWidth } = createColGroup(table, cellMinWidth);
  const style = tableWidth ? `width: ${tableWidth}` : tableMinWidth ? `min-width: ${tableMinWidth}` : null;
  const attrs = style ? { style } : {};
  return colgroup ? ['table', attrs, colgroup] : ['table', attrs];
}

/** Splits rendered rows into head and body, by the table's leading header rows. */
export function splitTableRows<T>(table: PMNode, rows: readonly T[]): { head: T[]; body: T[] } {
  const count = tableHeadRows(table);
  return { head: rows.slice(0, count), body: rows.slice(count) };
}
