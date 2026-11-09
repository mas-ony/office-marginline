# @marginline/core

The engine of Marginline, a Word (DOCX) editor for desktop and mobile that runs in the browser.
It holds everything the React and Vue interfaces share:

- DOCX import and export, keeping what the editor does not change (styles, numbering, sections,
  comments, tracked changes, fields, notes, images and unknown XML)
- the editor (`DocxEditor`): editing commands, pagination, headers and footers, footnotes and
  endnotes, fields, bookmarks, comments and tracked changes
- PDF export in the browser, with embedded font subsets
- the sharing session that talks to `@marginline/relay`
- the page API (`Marginline`, `installPageApi`)
- the interface's state and actions without a framework (`MarginlineUI`, `EditorStore`), which
  the interfaces render

To put the editor in an application, install `@marginline/react` or `@marginline/vue`. Both
depend on this package and re-export its option types. Use this package directly for the page
API, or to write an interface for another framework.

## Install

```bash
npm install @marginline/core
```

## Page API

Each editor has a page API instance, which the components pass to `onReady` (`@ready` in Vue).
`installPageApi(ml)` puts it on the page: `window.marginline` for that editor, `window.Marginline`
to start over with a configuration, and `window.docxEditor` for the native editor.

```js
import { installPageApi, Marginline } from '@marginline/core';

// onReady={(ml) => installPageApi(ml)}, then from anywhere on the page:
const ml = window.marginline;
const { items } = await ml.doc.query.match({ select: { type: 'text', pattern: 'twelve months' }, require: 'first' });
await ml.doc.replace({ target: items[0].target, text: 'eighteen months' }, { changeMode: 'tracked' });
ml.setDocumentMode('viewing');
ml.setViewingOptions({ trackedChanges: 'final' });
ml.on('zoomChange', ({ zoom }) => console.log(zoom));
const blob = await ml.export({ exportType: ['docx'], triggerDownload: false, commentsType: 'clean' });
await new Marginline({ document: '/examples/template.docx', documentMode: 'suggesting', user: { name: 'Jordan Lee' } }).ready;
```

`new Marginline()` drives an editor that is already on the page: by default the one given to
`installPageApi`, or with `selector` (an element or a CSS selector inside or around it) one of
several.

## Entry points

| Import | |
| --- | --- |
| `@marginline/core` | The editor, the page API, the sharing session, autosave and the interface state |
| `@marginline/core/views` | What the React and Vue interfaces are built from (editing commands and view helpers). It follows those packages and is not a stable API of its own |
| `@marginline/core/style.css` | The fonts, the ProseMirror base styles, the document styles and the interface |

The `style.css` of `@marginline/react` and `@marginline/vue` imports this package's. The
stylesheet imports the fonts from the `@fontsource` packages, and the PDF export reads the font
files those rules point at, so the application's bundler has to handle CSS `@import` and font
files (Vite does by default).

## License

MIT. The fonts (Carlito, Caladea, Tinos, Arimo and Cousine, from their `@fontsource` packages)
are under the SIL Open Font License 1.1.
