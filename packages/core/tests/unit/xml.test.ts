import { describe, expect, it } from 'vitest';
import { parseFragments, parseXml, serializeNode, serializeXml, stripInvalidXmlChars } from '../../src/core/xml/xml';

describe('xml', () => {
  it('normalizes non-canonical prefixes to canonical ones', () => {
    const src = '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:body><x:p x:rsidR="00A1"><x:hyperlink rel:id="rId5"/></x:p></x:body></x:document>';
    const { root } = parseXml(src);
    expect(root.name).toBe('w:document');
    const p = (root.children[0] as never as { children: { name: string; attrs: Record<string, string>; children: { attrs: Record<string, string> }[] }[] }).children[0];
    expect(p.name).toBe('w:p');
    expect(p.attrs['w:rsidR']).toBe('00A1');
    expect(p.children[0].attrs['r:id']).toBe('rId5');
  });

  it('maps strict namespaces and a default namespace to canonical prefixes', () => {
    const { root } = parseXml('<document xmlns="http://purl.oclc.org/ooxml/wordprocessingml/main"><body/></document>');
    expect(root.name).toBe('w:document');
    expect((root.children[0] as { name: string }).name).toBe('w:body');
  });

  it('keeps unknown namespaces and translates mc:Ignorable prefixes', () => {
    const src = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wx="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:foo="urn:example:foo" mc:Ignorable="wx foo"><foo:bar foo:baz="1"/></w:document>';
    const doc = parseXml(src);
    expect(doc.root.attrs['mc:Ignorable']).toBe('w14 foo');
    expect(doc.extraNamespaces.foo).toBe('urn:example:foo');
    expect((doc.root.children[0] as { name: string }).name).toBe('foo:bar');
  });

  it('preserves significant whitespace in w:t and decodes entities', () => {
    const { root } = parseXml('<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n  <w:r>\n    <w:t xml:space="preserve">  a &amp; b &#x41;&#66; </w:t>\n  </w:r>\n</w:p>');
    const xml = serializeNode(root);
    expect(xml).toBe('<w:p><w:r><w:t xml:space="preserve">  a &amp; b AB </w:t></w:r></w:p>');
  });

  it('serializes with namespace declarations and escapes attributes', () => {
    const { root } = parseXml('<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:a="&quot;x&quot; &lt;y&gt;"/>');
    const out = serializeXml(root, { namespaces: { w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' } });
    expect(out).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
    expect(out).toContain('w:a="&quot;x&quot; &lt;y&gt;"');
  });

  it('round-trips fragments', () => {
    const frag = '<w:tab w:val="left" w:pos="720"/><w:jc w:val="center"/>';
    const els = parseFragments(frag);
    expect(els.map(serializeNode).join('')).toBe(frag);
  });

  it('strips characters that are invalid in XML 1.0', () => {
    expect(stripInvalidXmlChars('a\u0000b\u000Bc\td')).toBe('abc\td');
  });

  it('handles comments, CDATA and processing instructions', () => {
    const { root } = parseXml('<?xml version="1.0"?><!-- c --><a><![CDATA[<b>]]><?pi x?></a>');
    expect(serializeNode(root)).toBe('<a>&lt;b&gt;</a>');
  });
});
