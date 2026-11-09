import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin, Rollup } from 'vite';

/** The package a file belongs to: the nearest package.json above it that has a name. */
function packageOf(file: string): { dir: string; name: string; version: string; license?: string } | null {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name, version = '0.0.0', license } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string; license?: string };
    if (name) return { dir, name, version, license };
  }
  return null;
}

/** The permission notice of the MIT licence, from the nearest LICENSE above `dir` (the project's own). */
function mitPermission(dir: string): string {
  for (; dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, 'LICENSE');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const at = text.indexOf('Permission is hereby granted');
    return at < 0 ? '' : text.slice(at).trim();
  }
  return '';
}

/** The comment at the top of a script, without its comment markers and rules, if it holds a copyright. */
function headerNotice(file: string): string | null {
  const comment = /^(?:\/\/.*\n)+/.exec(readFileSync(file, 'utf8'))?.[0];
  if (!comment?.includes('Copyright')) return null;
  return comment.split('\n').map((line) => line.replace(/^\/\/ ?/, '')).filter((line) => !/^-+$/.test(line)).join('\n').trim();
}

/**
 * Vite writes only the heading for a package that has no licence file, such as qrcode-generator.
 * This adds the notice at the top of the package's bundled script and, for an MIT package, the MIT
 * permission notice.
 */
function fillNotices(text: string, bundle: Rollup.OutputBundle, root: string): string {
  const scripts = new Map<string, string[]>();
  for (const file of Object.values(bundle)) {
    if (file.type !== 'chunk') continue;
    for (const id of file.moduleIds) {
      if (!id.includes('/node_modules/') || !existsSync(id)) continue;
      const pkg = packageOf(id);
      const key = pkg && `${pkg.name} - ${pkg.version}`;
      if (key) scripts.set(key, [...(scripts.get(key) ?? []), id]);
    }
  }
  const permission = mitPermission(root);
  // A heading followed by the next heading or the end of the file.
  return text.replace(/^## (\S+ - \S+)(?: \((.+)\))?\n(?=\n## |\n?(?![\s\S]))/gm, (heading: string, key: string, license?: string) => {
    const notice = scripts.get(key)?.map(headerNotice).find((n) => n);
    if (!notice) return heading;
    return `${heading}\n${notice}\n${license === 'MIT' && permission ? `\n${permission}\n` : ''}`;
  });
}

/**
 * Vite's licence file (`build.license`) lists the packages of the bundled scripts only. The fonts
 * come in through CSS `@import`, so this adds the packages of the other files the build took from
 * node_modules, in the same format, and fills in the packages that have no licence file.
 */
export function assetLicenses(fileName = 'THIRD-PARTY-LICENSES.md'): Plugin {
  let root = '';
  return {
    name: 'asset-licenses',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    // After Vite's own licence plugin has written the list.
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const list = bundle[fileName];
        if (list?.type !== 'asset') return;
        const text = String(list.source);
        const added = new Map<string, string>();
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset') continue;
          for (const original of file.originalFileNames) {
            const path = resolve(root, original);
            if (!path.includes('/node_modules/')) continue;
            const pkg = packageOf(path);
            const key = pkg && `${pkg.name}@${pkg.version}`;
            if (!pkg || !key || added.has(key) || text.includes(`\n## ${pkg.name} - ${pkg.version}`)) continue;
            const licence = readdirSync(pkg.dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
            const body = licence ? `\n${readFileSync(join(pkg.dir, licence), 'utf8').trim()}\n` : '';
            added.set(key, `\n## ${pkg.name} - ${pkg.version}${pkg.license ? ` (${pkg.license})` : ''}\n${body}`);
          }
        }
        const sorted = [...added].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        list.source = fillNotices(text + sorted.map(([, entry]) => entry).join(''), bundle, root);
      },
    },
  };
}
