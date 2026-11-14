# Marginline features

What Marginline does, area by area. [The README](../README.md) covers running it, the components
and the tests.

## Platforms and files

| Feature | Details |
| --- | --- |
| Browsers | Tested in Chrome on desktop and on Android |
| Phones | Text reflowed to the screen at a readable size (pages on demand, scaled to fit), a scrolling toolbar row that starts with formatting, review and fields panels, menus and dialogs as bottom sheets, a comment button next to the selection, a menu with examples, insert, export, share and customize |
| Plain-HTTP LAN address | No secure-context API is required; clipboard, file pickers, sharing and offline caching are used only where available |
| Open a `.docx` | Upload DOCX, drag and drop, `?src=<url>` and the system's "Open with" for the installed app |
| Example documents | Six in the Examples menu (Review, Templating, 300 pages, Tables & columns, International & RTL, Formatting); `?example=<id>` opens one |
| New document | Examples › Blank document, or `?new=1` |
| File name | Click to rename; a dot marks unsaved changes |
| Export DOCX | Comments with replies and resolved state, tracked changes with authors and dates, fields, bookmarks and notes are written to the file; everything the editor does not change is kept |
| Export PDF | Written in the browser, offline: embedded TrueType subsets with Unicode text, links; right-to-left, complex-script and CJK words are drawn as images |
| Print | The print layout through the browser's print dialog |
| Autosave and recovery | A copy in IndexedDB, offered back with a restore banner |
| Installable app, offline | PWA with a `.docx` file handler (offline caching needs HTTPS or localhost) |
| Long documents | The 300-page example opens in about a second |

## Header

| Feature | Details |
| --- | --- |
| Header | Upload DOCX, file name, Examples, Share, Customize, Export ▾ and the side panel toggle; Export also offers Print… and, where the browser can share files, Send file… |
| People in a shared session | Avatars of everyone connected |
| Keyboard shortcuts | A dialog listing the shortcuts |

## Toolbar

| Feature | Details |
| --- | --- |
| Layout | One row; items leave the row by priority as the window narrows and move into Overflow "⋮"; on phones the row scrolls instead |
| Text formatting | Undo, Redo, Bold, Italic, Underline, Strikethrough |
| Zoom | 50, 75, 90, 100, 125, 150, 200 % and Fit width |
| Font family | 8 fonts, editable, each shown in its own face; Carlito, Caladea, Arimo, Tinos and Cousine stand in for Office fonts that are not installed |
| Font size | 8 to 96, editable |
| Color and Highlight | 8 rows of 7 named swatches; Highlight also has None |
| Link | Text, "Type or paste a link", Apply; edit and remove; Ctrl+click opens a link |
| Image | File picker, paste and drag and drop; resize handles |
| Table | Grid picker and table actions (11 items, including Remove borders and Fix tables) |
| Alignment, indents, line height | Left, center, right, justify; left and right indent; line height 1.00 to 3.00 |
| Lists | Bullet list with 3 styles, numbered list with 8 formats (1. 1) I. i. A. A) a. a)); Tab and Shift+Tab change the level |
| Linked styles | The paragraph styles of the document, each shown in its formatting |
| Copy formatting, Clear formatting | Copy formatting picks up the formatting at the cursor and applies it to the next selection |
| Ruler | Inch scale; drag the page margins and the first-line, hanging, left and right indents |
| Search | Find bar with replace, match case and regular expressions: previous/next, Replace, Replace all; `$1` groups in replacements |
| Document mode | Editing, Suggesting, Viewing with their descriptions; Ctrl+Shift+E turns Suggesting on and off |
| Custom toolbar buttons | `marginline.toolbar.addButton()`; Customize has an example that adds a button inserting today's date |

## Review: comments and suggestions

| Feature | Details |
| --- | --- |
| Review tab | "N changes · M comments", cards in document order; clicking a card selects its text, and the cursor in commented text highlights its card |
| Comment from a selection | A floating button and a composer (Cancel, Comment); also the right-click menu, Ctrl+Alt+M and Add comment at the bottom of the panel |
| Replies | "Reply or add others with @"; @ lists the people who wrote in the document |
| Edit, Delete, resolve, reopen | A Resolved checkbox shows resolved threads |
| Suggesting | Insertions in a dashed box, deletions struck through, a card per change ("Added", "Deleted", "Replaced … with …"); formatting changes are suggested too |
| Accept and reject | ✓ and ✕ per change, Accept all and Reject all |
| Imported comments and changes | An IMPORTED badge marks those that came with the file |
| Viewing | Original, markup or final, also chosen in the Review tab while Viewing (Original, Markup, Final, Comments on or off) |
| Author | "Your name" in Customize (kept in the browser), or `user` in the API |

## Fields and templates

| Feature | Details |
| --- | --- |
| Fields tab | Each field's name and value; a value fills every place the field appears; fields can be renamed and removed (the text stays) |
| Add a field | Drag "New field" onto the page, or click it to insert at the cursor; on phones Menu › Insert field |
| Fields in the DOCX | Word content controls (`w:sdt` with a tag), fillable in Word too |

## Right-click menu

| Feature | Details |
| --- | --- |
| Editing | Comment; Cut, Copy; Keep Source Formatting, Match Destination Formatting, Keep Text Only; Undo, Redo; paste needs the browser's clipboard permission, otherwise Ctrl+V |
| Bookmarks and cross-references | Create bookmark, Insert cross-reference: to bookmarks or headings, inserted as links to the bookmark (a heading gets a hidden `_Ref` bookmark, as in Word) |
| Insert | Insert link, Insert table, Insert footnote; footnotes are written to the file's notes part, and a click on a note edits it |
| In a table | Edit table ▸, Cell background |
| Phones | The browser's own selection menu, plus the comment button and the phone menu |

## Pages and document content

| Feature | Details |
| --- | --- |
| Pages | Margins, sections, headers and footers, page numbers; line-level paragraph splits, table rows across pages, keep with next, widow and orphan control |
| Headers and footers | Double-click the header or footer area to edit it (not while sharing). Its bar has Options, Remove and Close; Options inserts the page number, total pages, section pages or "Page X of Y" and sets a different first page, different odd and even pages, link to previous and the header and footer distances (in inches, or centimetres where the ruler is metric) |
| Footnotes and endnotes | Insert and edit; footnotes at the bottom of their page |
| Tables | Merged cells, column widths, column resizing |
| Shapes and groups | Shapes, text boxes, groups of shapes and pictures, and drawing canvases are drawn with their outlines, theme colours, gradients, dashes and arrowheads, on the page and in PDF files; they are kept unchanged and not edited |
| Columns | Sections with several columns |
| Right-to-left and CJK | Right-to-left paragraphs and CJK text |

## Customize and appearance

| Feature | Details |
| --- | --- |
| Themes | Modern, Docs, Word, Blueprint |
| Appearance | System, Light or Dark in Customize |

## Sharing

| Feature | Details |
| --- | --- |
| Edit together in real time | Through the relay (`@marginline/relay`, inside the dev and preview servers or as Node middleware; ProseMirror collaboration steps over HTTP and Server-Sent Events): a link and a QR code, who is here, everyone's cursors, shared comments |

## Programming interface

The editor is embedded with the `MarginlineEditor` component of `@marginline/react` or
`@marginline/vue`, or with their `mount()`. Each editor has a page API instance
(`packages/core/src/api/marginline.ts`), which the apps install as `window.marginline` once the
first document has opened, with `window.Marginline` (the class). `new Marginline(config)` drives
an editor already on the page rather than creating a new one. `window.docxEditor` gives access to
the editor itself (`DocxEditor`, `packages/core/src/editor/DocxEditor.ts`).

| Feature | Details |
| --- | --- |
| Components | `MarginlineEditor` for React and for Vue, each written for its framework, with the same props and events (Vue: `v-model:theme` and the like), and `mount(element, options)` for other pages; styles scoped to the editor, several editors on a page |
| `new Marginline(config)` | `selector` picks one of the editors on the page; `document` (a URL, Blob, ArrayBuffer or bytes), `documentMode`, `user`, `viewing`, `title`, `diagnostics`; callbacks `onReady`, `onEditorCreate`, `onEditorUpdate`, `onCommentsUpdate`, `onContentError`, `onException`, `onTrackedChangesBulkDecision` |
| Document mode and viewing | `setDocumentMode`, `setViewingOptions`, `documentMode` |
| Export | `export({ exportType, exportedName, triggerDownload, commentsType })`: DOCX and PDF; `commentsType: 'clean'` leaves the comments out |
| Open another file | `replaceFile`, `replaceDocument` (`{ ok, reason, detail }`), `ui.open()` |
| Events | `on`, `off`, `once`: `ready`, `editorCreate`, `editorUpdate`, `zoomChange`, `documentModeChange`, `commentsUpdate`, `trackedChangesUpdate`, `fieldsUpdate`, `selectionUpdate`, `contentError`, `exception` |
| Diagnostics | `diagnostics.getSnapshot()`, `diagnostics.clear()`: event types and times only (no content capture) |
| Document API | `doc.query.match`, `doc.replace` with `changeMode: 'tracked'` and receipts (targets carry a document revision; a stale target fails with a receipt); `doc.trackChanges.list`, `get`, `decide`; `doc.getText`, `doc.delete`, `doc.text.insert`, `doc.comments` (list, create, reply, resolve, reopen, delete), `doc.fields` (list, set, insert) |
| Toolbar | `toolbar.addButton`, `toolbar.removeButton` |
| Interface | `ui.openPanel`, `ui.closePanel`, `ui.setTheme`, `ui.setColorScheme`, `ui.toast`, `ui.open` |
| Editor commands | `activeEditor.commands`: formatting, lists, alignment, links, tables, comments, undo and redo |

## Limitations

- Sharing needs the relay (in the dev and preview servers, or `@marginline/relay` on another
  server); rooms live in memory, anyone who can reach the server with the link can join, and
  headers, footers and footnotes cannot be edited while a document is shared.
- Line numbering (for example on pleading paper) is kept in the file but not shown, and very long
  documents are laid out in full, without page virtualisation.
- Block-level content controls are opened as plain content; only inline ones become fields.
- In multi-column sections a paragraph moves to the next column as a whole; a footnote taller
  than the space left on its page is not continued on the next page.
- Equations, charts and SmartArt are kept unchanged but shown as placeholders.
- Shapes, text boxes, groups and drawing canvases are drawn but cannot be edited or moved. Like
  floating pictures, they are placed from their paragraph and column, so positions measured from the
  page or its margins come out shifted; shadows, glows and 3-D effects are not drawn.
- Fonts that are not installed are replaced with metric-compatible open fonts, so line breaks can
  differ slightly from Word.
- In PDF files, words in right-to-left, complex and CJK scripts are pictures, not selectable text.
- The editor runs in the browser only; there is no server-side or command-line version.
