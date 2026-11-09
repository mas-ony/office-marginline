# Marginline

Marginline is a Word (DOCX) editor for desktop and mobile that runs in the browser: a one-row
toolbar, a review panel with comments and suggestions, Editing, Suggesting and Viewing modes,
fillable fields, themes and a page API. On phones it reflows the text and has a touch layout, and it
also works over a plain HTTP address on the local network. PDF export runs in the browser.

This package is the built app: static files to put on a web server. It has no dependencies and
nothing to build. The React and Vue packages, for putting the editor inside an app instead, are in
the [repository](https://github.com/mas-ony/office-marginline) (`packages/react` and `packages/vue`) and
are not on npm yet.

## Install

```bash
npm install marginline
```

## Host

The app is the package's `dist` folder: `index.html`, `assets/`, the example documents, the
service worker, the manifest and the icons. Its paths are relative, so it can be served from any
path. Copy the folder into a site, or serve it as it is:

```bash
cp -r node_modules/marginline/dist public/docs                 # then open /docs/
python3 -m http.server -d node_modules/marginline/dist 8080    # then open http://localhost:8080
```

Serve it over HTTP: browsers do not run its scripts from a `file://` address.

Over HTTPS (or on `localhost`) the app also works offline and can be installed, and an installed
app opens DOCX files from the system's "Open with". Over plain HTTP, such as a local network
address, the clipboard API, file pickers, the share sheet and offline use are not available, and
the app works without them.

## Files

It opens DOCX files by drag and drop, from its menu or with `?src=`, and comes with six example
documents and a blank one. It saves DOCX, exports PDF and prints; on phones it can also send the
file through the share sheet. The saved DOCX keeps what the editor does not change: styles,
numbering, sections, headers and footers, comments with replies, tracked changes, fields, notes,
images, tables and unknown XML. Files are opened, edited and saved in the browser; unless a
document is shared, the app sends nothing to a server.

## Address options

| Option | |
| --- | --- |
| `?src=<url>` | Opens a document from a URL the page can fetch (its own server, or one that allows it with CORS) |
| `?example=<id>` | Opens an example: `agreement`, `template`, `long`, `tables`, `international` or `formatting` |
| `?new` | Starts with a blank document, without offering to recover unsaved work |
| `?room=<id>` | Joins a shared document (needs the relay, below) |

## Sharing

Editing together in real time (**Share > Start collaboration**) needs Marginline's relay on the
same server, answering under `/collab`. The relay is a Vite plugin or Node middleware in the
repository's `packages/relay`; it is not part of this package and not on npm yet. Served as static
files, the app has no relay: the Share dialog says so and cannot start a session, and `?room=`
links do not open.

## Page API

Once a document is open, the app puts a programmatic interface on the page: `window.marginline`
for the editor, `window.Marginline` to start over with a configuration, and `window.docxEditor`
for the native editor. A page that shows the app in a same-origin `<iframe>` reaches them through
`iframe.contentWindow`.

```js
const ml = window.marginline;
const { items } = await ml.doc.query.match({ select: { type: 'text', pattern: 'twelve months' }, require: 'first' });
await ml.doc.replace({ target: items[0].target, text: 'eighteen months' }, { changeMode: 'tracked' });
const changes = await ml.doc.trackChanges.list();
ml.setDocumentMode('viewing');
ml.setViewingOptions({ trackedChanges: 'final' });
ml.on('zoomChange', ({ zoom }) => console.log(zoom));
const blob = await ml.export({ exportType: ['docx'], triggerDownload: false, commentsType: 'clean' });
await new Marginline({ document: './examples/template.docx', documentMode: 'suggesting', user: { name: 'Jordan Lee' } }).ready;
```

## Storage

The app keeps unsaved work in IndexedDB (the database `marginline`) and offers to recover it on the
next visit. It keeps its settings (theme, appearance, ruler and the user's name) in localStorage
under `marginline-` keys, and its offline copy in the cache `marginline-v1`. Copies served from the
same origin share them.

## Browsers

Tested in Chrome on desktop and on Android.

## License

MIT. The app bundles third-party packages, icons and fonts: `dist/THIRD-PARTY-LICENSES.md` lists
them with their licences (MIT; ISC for the Lucide icons; the SIL Open Font License 1.1 for the
Arimo, Caladea, Carlito, Cousine and Tinos fonts).
