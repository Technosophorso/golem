// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { applyFeedEdits, createFeedAnchor, feedParagraph, importLegacyFeed, projectFeed, validateFeedComposition, walkFeed } from '@use-brian/doc-model';
import type { FeedAnchor, FeedEdit } from '@use-brian/shared';
import { en } from '@/lib/i18n/dictionaries/en';
import { CompositionEditor } from '../composition-editor';
import { feedMarkdownSlice } from '../editor-markdown';
vi.mock('@/lib/i18n/client', () => ({ useT: () => en }));
let host: HTMLDivElement; let root: Root;
const viewProps = vi.spyOn(EditorView.prototype, 'setProps');
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  // jsdom has no range geometry; leave selection/paste behavior real.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
function renderEditor(text = '', readOnly = false, comments = false) {
  let composition = importLegacyFeed({ text: '', postFormat: 'post', threadSegments: [], media: [] });
  composition.segments[0]!.content = [feedParagraph(text)];
  const segment = composition.segments[0]!; const blockId = segment.content[0]!.attrs.id;
  let anchors: FeedAnchor[] = comments ? [createFeedAnchor(composition, { kind: 'range', spans: [{ segmentId: segment.id, blockId, from: 2, to: 8 }] }, 1)] : [];
  const onEdit = vi.fn((edits: FeedEdit[]) => { const result = applyFeedEdits(composition, edits, anchors); composition = result.composition; anchors = result.anchors; });
  act(() => root.render(<CompositionEditor composition={composition} readOnly={readOnly} threads={[]} onEdit={onEdit} onSelection={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />));
  const node = host.querySelector<HTMLElement>('[role=textbox]')!;
  const view = (viewProps.mock.contexts as EditorView[]).find(item => item.dom === node)!;
  return { view, onEdit, blockId, current: () => validateFeedComposition(composition), anchors: () => anchors };
}
function type(view: EditorView, text: string) {
  act(() => {
    view.focus();
    for (const char of text) {
      const { from, to } = view.state.selection;
      if (!view.someProp('handleTextInput', handler => handler(view, from, to, char, () => view.state.tr.insertText(char, from, to)))) view.dispatch(view.state.tr.insertText(char, from, to));
    }
  });
}
function key(view: EditorView, key: string, options: KeyboardEventInit = {}) {
  act(() => { view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key, ...options }))); });
}
function paste(view: EditorView, text: string, html = '') {
  act(() => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '', files: [] } });
    view.dom.dispatchEvent(event);
  });
}
describe('[COMP:app-web/feed-editor-markdown] page-like Feed authoring', () => {
  it.each([['# ', 'heading'], ['### ', 'heading'], ['- ', 'bulletList'], ['+ ', 'bulletList'], ['1. ', 'orderedList'], ['> ', 'blockquote']])('converts %j into a real %s and Backspace restores the shortcut', (prefix, kind) => {
    const editor = renderEditor(); type(editor.view, prefix!);
    expect(editor.view.state.doc.firstChild!.type.name).toBe(kind);
    expect(walkFeed(editor.current()).some(row => row.node.attrs.id === editor.blockId)).toBe(true);
    key(editor.view, 'Backspace');
    expect(editor.view.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(editor.view.state.doc.textContent).toBe(prefix);
    expect(projectFeed(editor.current()).text).toContain(prefix!.trim());
  });
  it.each([['**bold**', 'strong', 'bold'], ['*italic*', 'em', 'italic'], ['[source](https://example.com)', 'a', 'source']])('converts %j into an inline mark and stops the mark at the closing delimiter', (source, selector, text) => {
    const editor = renderEditor(); type(editor.view, source!);
    expect(editor.view.dom.querySelector(selector!)?.textContent).toBe(text);
    type(editor.view, ' plain');
    expect(editor.view.dom.querySelector(selector!)?.textContent).toBe(text);
    expect(editor.view.state.doc.textContent).toBe(`${text} plain`);
  });
  it('continues lists, exits empty items, and inserts soft line breaks', () => {
    const editor = renderEditor(); type(editor.view, '- First'); key(editor.view, 'Enter'); type(editor.view, 'Second');
    expect(editor.view.dom.querySelectorAll('li')).toHaveLength(2);
    key(editor.view, 'Enter'); key(editor.view, 'Enter'); type(editor.view, 'After'); key(editor.view, 'Enter', { shiftKey: true }); type(editor.view, 'line');
    expect(editor.view.state.doc.lastChild!.type.name).toBe('paragraph');
    expect(editor.view.dom.querySelectorAll('li')).toHaveLength(2);
    expect(editor.view.state.doc.lastChild!.toJSON().content).toContainEqual({ type: 'hardBreak' });
  });
  it('keeps existing comment ranges attached through prefix conversion and Backspace', () => {
    const editor = renderEditor('- Target phrase.', false, true);
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2))));
    // Insert the trigger space between '-' and the existing space.
    type(editor.view, ' ');
    expect(editor.view.state.doc.firstChild!.type.name).toBe('bulletList');
    expect(editor.anchors()[0]).toMatchObject({ state: 'attached', target: { spans: [{ blockId: editor.blockId, from: 1, to: 7 }] } });
    key(editor.view, 'Backspace');
    expect(editor.anchors()[0]).toMatchObject({ state: 'attached', target: { spans: [{ blockId: editor.blockId, from: 3, to: 9 }] } });
  });
  it('pastes Markdown blocks at a selection and supports normal Undo/Redo', () => {
    const editor = renderEditor('Keep. Replace. Tail.');
    act(() => { editor.view.focus(); editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 7, 15))); });
    paste(editor.view, '# Heading\n\n- **One**\n- Two');
    expect(editor.view.dom.querySelector('h1')?.textContent).toContain('Heading');
    expect(editor.view.dom.querySelectorAll('li')).toHaveLength(2);
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('One');
    expect(editor.view.state.doc.textContent).toContain('Keep.'); expect(editor.view.state.doc.textContent).toContain('Tail.');
    const pasted = editor.view.state.doc.toJSON();
    key(editor.view, 'z', { ctrlKey: true }); expect(editor.view.state.doc.textContent).toBe('Keep. Replace. Tail.');
    key(editor.view, 'z', { ctrlKey: true, shiftKey: true }); expect(editor.view.state.doc.toJSON()).toEqual(pasted);
  });
  it('supports inline Markdown paste and explicit paste without formatting', () => {
    const editor = renderEditor(); paste(editor.view, '**Bold** and *italic*.');
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Bold');
    key(editor.view, 'v', { ctrlKey: true, shiftKey: true }); paste(editor.view, '\n# Literal\n- Literal');
    expect(editor.view.dom.querySelector('h1')).toBeNull(); expect(editor.view.dom.querySelector('ul')).toBeNull();
    expect(editor.view.state.doc.textContent).toContain('# Literal');
  });
  it.each(['```md\n# Inside code\n```', '| A | B |\n|---|---|', '- [ ] Task', '<h1>HTML</h1>', '![Image](https://example.com/image.png)', '[bad](javascript:alert(1))', '0. Invalid start'])('preserves unsupported paste literally: %j', source => {
    expect(feedMarkdownSlice(source)).toBeNull();
  });
  it('does not transform rich HTML clipboard data or mutate a read-only editor', () => {
    const editor = renderEditor('', true);
    type(editor.view, '# '); paste(editor.view, '# Heading\n\nBody'); key(editor.view, 'Enter', { shiftKey: true });
    expect(editor.onEdit).not.toHaveBeenCalled();
    expect(editor.view.state.doc.textContent).toBe('');
    const event = { clipboardData: { getData: () => '<p>Rich HTML</p>' } } as unknown as ClipboardEvent;
    expect(editor.view.someProp('handlePaste', handler => handler(editor.view, event, null!))).toBeUndefined();
  });
});
