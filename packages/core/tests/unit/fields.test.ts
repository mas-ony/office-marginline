import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importDocx } from '../../src/core/import/importer';
import { listFields } from '../../src/editor/fields';
import { caret, findRange, openEditor, selectText } from './editorHelpers';
import { example } from './helpers';

const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']);

describe('fields (content controls)', () => {
  it('lists the controls of a template by name, with their values', () => {
    const doc = importDocx(example('template.docx'));
    const fields = listFields(doc.body);
    expect(fields.map((f) => f.name)).toEqual(['effective_date', 'client_name', 'consultant_name', 'project_name', 'start_date', 'end_date', 'fee', 'client_contact', 'consultant_contact']);
    const client = fields.find((f) => f.name === 'client_name')!;
    expect(client.value).toBe('Northwind Traders');
    expect(client.alias).toBe('Client Name');
    // Used in the opening sentence and in the signature block.
    expect(client.ranges).toHaveLength(2);
  });

  it('fills every control with a name and keeps them as content controls', () => {
    const ed = openEditor(example('template.docx'), 'template.docx');
    expect(ed.setFieldValue('client_name', 'Contoso Ltd')).toBe(true);
    const fields = ed.fields();
    expect(fields.find((f) => f.name === 'client_name')?.value).toBe('Contoso Ltd');
    expect(ed.view.state.doc.textContent).not.toContain('Northwind Traders');
    const xml = documentXml(ed.exportDocx());
    expect(xml.match(/<w:tag w:val="client_name"\/>/g)).toHaveLength(2);
    expect(xml).toContain('Contoso Ltd');
    const again = listFields(importDocx(ed.exportDocx()).body).find((f) => f.name === 'client_name');
    expect(again?.value).toBe('Contoso Ltd');
    ed.destroy();
  });

  it('shows a placeholder for an empty value and writes showingPlcHdr', () => {
    const ed = openEditor(example('template.docx'), 'template.docx');
    ed.setFieldValue('fee', '');
    const fee = ed.fields().find((f) => f.name === 'fee')!;
    expect(fee.placeholder).toBe(true);
    expect(fee.value).toBe('');
    expect(ed.view.state.doc.textContent).toContain('[Fee]');
    const xml = documentXml(ed.exportDocx());
    const sdt = xml.slice(xml.indexOf('<w:tag w:val="fee"/>') - 200, xml.indexOf('<w:tag w:val="fee"/>') + 300);
    expect(sdt).toContain('<w:showingPlcHdr/>');
    ed.destroy();
  });

  it('inserts a field at the caret or around the selection, and renames it', () => {
    const ed = openEditor(example('template.docx'), 'template.docx');
    const r = findRange(ed, 'three equal instalments');
    caret(ed, r.from);
    const name = ed.insertField();
    expect(name).toBe('field_1');
    expect(ed.fields().find((f) => f.name === 'field_1')?.placeholder).toBe(true);
    selectText(ed, 'three equal instalments');
    expect(ed.insertField({ name: 'schedule' })).toBe('schedule');
    expect(ed.fields().find((f) => f.name === 'schedule')?.value).toBe('three equal instalments');
    expect(ed.renameField('schedule', 'payment_schedule')).toBe(true);
    const xml = documentXml(ed.exportDocx());
    expect(xml).toContain('<w:tag w:val="payment_schedule"/>');
    expect(xml).toContain('<w:alias w:val="field_1"/>');
    ed.destroy();
  });

  it('removes a field but keeps its text', () => {
    const ed = openEditor(example('template.docx'), 'template.docx');
    expect(ed.removeField('project_name')).toBe(true);
    expect(ed.fields().some((f) => f.name === 'project_name')).toBe(false);
    expect(ed.view.state.doc.textContent).toContain('Supply Chain Review');
    ed.destroy();
  });
});
