// @vitest-environment jsdom
import { nineLevelNumberingFixture } from '../../../../../../packages/core/src/office/__tests__/docx-numbering-fixture';
import { importOfficeDocument } from '../../../../../../packages/core/src/office/docx';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { getDocumentFragment, snapshotToYDoc, yDocToSnapshot } from '@use-brian/office-model';
import { officeDocumentEditorExtensions } from '../document/editor-schema';
import { documentFixture, uid } from './editor-fixtures';

function setup() {
  const snapshot = documentFixture();
  const style = { fontFamily: 'Arial', fontSizePt: 12, color: '#111111', bold: false, italic: false, underline: false, strike: false, widthScalePercent: 80 };
  const numbering = { listId: uid(600), format: 'upperRoman' as const, start: 1, pattern: '%1)' };
  snapshot.sections[0].nodes = [0, 1].map(i => ({ id: uid(610 + i), kind: 'paragraph', styleName: 'Body', alignment: 'start', indentLeftPt: 36, hangingPt: 36, numbering: { ...numbering, ...(i === 1 ? { markerStyle: { color: '#FF0000' } } : {}) }, runs: [{ id: uid(620 + i), text: '☐ Alpha Beta 中文', style }] }));
  const doc = snapshotToYDoc(snapshot);
  const editor = new Editor({ extensions: [...officeDocumentEditorExtensions(), Collaboration.configure({ fragment: getDocumentFragment(doc) })] });
  return { snapshot, doc, editor };
}

describe('[COMP:app-web/office-document-editor] Inline fidelity', () => {
  it('imports nine-level native XML through canonical/Yjs into visible derived markers', async () => {
    const result = await importOfficeDocument(await nineLevelNumberingFixture(), { artifactId: uid(700), workspaceId: uid(701), templateVersionId: null, locale: 'en-US', defaultLanguage: 'en-US', title: 'Synthetic numbered sections' });
    expect(result.ok).toBe(true);
    if (result.snapshot?.family !== 'document') throw new Error('document');
    const doc = snapshotToYDoc(result.snapshot);
    const editor = new Editor({ extensions: [...officeDocumentEditorExtensions(), Collaboration.configure({ fragment: getDocumentFragment(doc) })] });
    expect([...editor.view.dom.querySelectorAll('[data-office-number-marker]')].map(m => m.textContent)).toEqual(['I)', 'II)', 'A)', 'B)', 'C)', 'D)']);
    expect(editor.view.dom.querySelector('td [data-office-number-marker]')?.textContent).toBe('B)');
    expect(yDocToSnapshot(doc)).toEqual(result.snapshot);
    expect(editor.view.dom.querySelector('p')?.style.getPropertyValue('--office-run-line-height')).toBe('0');
    expect(editor.view.dom.querySelector<HTMLElement>('td p')?.style.getPropertyValue('--office-run-line-height')).toBe('0');
    editor.destroy(); doc.destroy();
  });

  it('projects styled Roman markers and scaled wrapping segments without changing editable or collaborative text', () => {
    const { snapshot, doc, editor } = setup();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const markers = editor.view.dom.querySelectorAll<HTMLElement>('[data-office-number-marker]');
    expect([...markers].map(m => m.textContent)).toEqual(['I)', 'II)']);
    expect(markers[1].style.color).toBe('rgb(255, 0, 0)');
    expect(markers[0].contentEditable).toBe('false');
    const segments = editor.view.dom.querySelectorAll<HTMLElement>('[data-office-width-scale]');
    expect(segments.length).toBeGreaterThan(4);
    expect([...segments].some(s => s.textContent === 'Alpha Beta 中文')).toBe(false);
    expect(segments[0].style.width).not.toBe('');
    expect(segments[0].style.transform).toBe('scaleX(0.8)');
    expect(segments[0].getAttribute('contenteditable')).not.toBe('false');
    expect(yDocToSnapshot(doc)).toEqual(snapshot);
    let start = 0;
    editor.state.doc.descendants((node, position) => { if (node.attrs.id === uid(610)) start = position + 1; });
    editor.commands.setTextSelection({ from: start, to: start + 1 });
    editor.commands.insertContent('☒');
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(yDocToSnapshot(peer)).toEqual(yDocToSnapshot(doc));
    const result = yDocToSnapshot(doc);
    if (result.family !== 'document' || result.sections[0].nodes[0].kind !== 'paragraph') throw new Error('paragraph required');
    expect(result.sections[0].nodes[0].runs.map(r => r.text).join('')).toBe('☒ Alpha Beta 中文');
    expect(result.sections[0].nodes[0].runs.every(r => r.style.widthScalePercent === 80)).toBe(true);
    expect(editor.state.doc.textContent).not.toContain('I)');
    editor.destroy(); doc.destroy(); peer.destroy();
  });

  it('merges two-client checkbox and text edits while retaining canonical numbering and scale', () => {
    const { doc, editor } = setup();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const peerEditor = new Editor({ extensions: [...officeDocumentEditorExtensions(), Collaboration.configure({ fragment: getDocumentFragment(peer) })] });
    let start = 0, end = 0;
    editor.state.doc.descendants((node, position) => { if (node.attrs.id === uid(610)) { start = position + 1; end = position + node.nodeSize - 1; } });
    editor.commands.setTextSelection({ from: start, to: start + 1 });
    editor.commands.insertContent('☒');
    peerEditor.commands.setTextSelection(end);
    peerEditor.commands.insertContent(' Peer');
    const localUpdate = Y.encodeStateAsUpdate(doc);
    const remoteUpdate = Y.encodeStateAsUpdate(peer);
    Y.applyUpdate(doc, remoteUpdate);
    Y.applyUpdate(peer, localUpdate);
    expect(yDocToSnapshot(doc)).toEqual(yDocToSnapshot(peer));
    const snapshot = yDocToSnapshot(doc);
    if (snapshot.family !== 'document' || snapshot.sections[0].nodes[0].kind !== 'paragraph') throw new Error('paragraph');
    const paragraph = snapshot.sections[0].nodes[0];
    expect(paragraph.runs.map(r => r.text).join('')).toBe('☒ Alpha Beta 中文 Peer');
    expect(paragraph.runs.every(r => r.style.widthScalePercent === 80)).toBe(true);
    expect(paragraph.numbering?.format).toBe('upperRoman');
    peerEditor.destroy(); editor.destroy(); peer.destroy(); doc.destroy();
  });

  it('recomputes counters after deleting a paragraph, retaining marker style and scale after undo', () => {
    const { doc, editor } = setup();
    let pos = 0, size = 0;
    editor.state.doc.descendants((node, position) => { if (node.attrs.id === uid(610)) { pos = position; size = node.nodeSize; } });
    editor.view.dispatch(editor.state.tr.delete(pos, pos + size));
    expect([...editor.view.dom.querySelectorAll('[data-office-number-marker]')].map(n => n.textContent)).toEqual(['I)']);
    editor.commands.undo();
    expect([...editor.view.dom.querySelectorAll('[data-office-number-marker]')].map(n => n.textContent)).toEqual(['I)', 'II)']);
    editor.destroy(); doc.destroy();
  });
});
