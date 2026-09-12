// @vitest-environment jsdom
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import type { FeedCommand, FeedEdit, FeedTarget, FeedPlaceholderAttrs, FeedGenerationEstimate } from '@use-brian/shared';
import { applyFeedEdits, createFeedAnchor, importLegacyFeed, projectFeed, proposeFeedReplacement } from '@use-brian/doc-model';
import { en } from '@/lib/i18n/dictionaries/en';
const state = vi.hoisted(() => ({ http: vi.fn(), upload: vi.fn(), image: vi.fn(), messages: { data: { messages: [] }, loading: false, error: undefined, refresh: vi.fn() } }));
vi.mock('@/components/doc/doc-file-url', () => ({ fetchDocFileBlob: (...args: unknown[]) => state.image(...args) }));
vi.mock('@/lib/auth-fetch', () => ({ authFetch: (...args: unknown[]) => state.http(...args) }));
vi.mock('@/lib/use-post-media', () => ({ usePostMedia: () => ({ upload: state.upload, resolve: vi.fn(), uploading: false }) }));
vi.mock('@/lib/i18n/client', () => ({ useT: () => en, useLocale: () => 'en' }));
vi.mock('@/lib/surface-cache', () => ({ useCachedResource: () => state.messages }));
vi.mock('@/lib/surface-prefetch', () => ({ feedCollaborationCacheKey: () => 'fixture-collaboration', goalsCacheKey: () => 'fixture-goals' }));
vi.mock('../tuning-chat-panel', () => ({ TuningChatPanel: (props: { sessionId: string }) => <div data-chat-session={props.sessionId} /> }));
import { GenerationPlaceholder, FeedGenerationResults, type FeedGenerationControls } from '../generation-placeholder';
import { CompositionEditor, FeedCompositionPreview } from '../composition-editor';
import editorStyles from '../composition-editor.module.css';
import { DraftCommentPanel, type FeedCommentPanelProps } from '../draft-comment-panel';
import { FeedReview, type FeedReviewActions } from '../feed-review';
let host: HTMLDivElement; let root: Root;
const viewProps = vi.spyOn(EditorView.prototype, 'setProps');
function editorView(node: HTMLElement): EditorView { return (viewProps.mock.contexts as EditorView[]).find(view => view.dom === node)!; }
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
const text = en.feedCollaboration;
const composition = () => importLegacyFeed({ text: 'First paragraph.\n\nThe same phrase.\n\nThe same phrase.', postFormat: 'post', threadSegments: [], media: [] });
function reviewActions(): FeedReviewActions { return { model: 'standard', setModel: vi.fn(), busy: false, error: false, start: vi.fn(async () => {}), action: vi.fn(async () => {}) }; }
describe('[COMP:app-web/feed-review] five-check controls', () => {
  it('scenario 16: Review requests checks without issuing any content command', async () => {
    const actions = reviewActions(); const onCommand = vi.fn();
    act(() => root.render(<FeedReview workspaceId="fixture" revision={2} actions={actions} onCommand={onCommand} onThread={vi.fn()} disabled={false} offline={false} />));
    expect(host.textContent).toContain(en.feedReview.notReviewed);
    await click(en.feedCollaboration.review);
    expect(actions.start).toHaveBeenCalledOnce(); expect(onCommand).not.toHaveBeenCalled();
  });
  it('scenarios 19-20: shows all five coverage states, old revisions, summary navigation and history continuation', async () => {
    const actions = reviewActions(); const onThread = vi.fn();
    const covered = { eligible: 55, retrieved: 50, reviewed: 50, limits: ['older_limit'] };
    const snapshot = { copy: null, threads: [], suggestions: [], runs: [{ id: 'run', kind: 'review' as const, revision: 2, status: 'succeeded' as const, attempts: 1, error: null, createdAt: '', model: 'standard', summaryThreadId: 'summary', coverage: { monthly_plan: { ...covered, state: 'checked' as const }, post_history: { ...covered, state: 'partial' as const, nextCursor: 20 }, post_goal: { ...covered, state: 'unavailable' as const }, memory: { ...covered, state: 'failed' as const }, content: { ...covered, state: 'checked' as const } } }] };
    act(() => root.render(<FeedReview workspaceId="fixture" revision={3} actions={actions} onCommand={vi.fn()} onThread={onThread} disabled={false} offline={false} snapshot={snapshot} />));
    for (const dimension of ['monthly_plan', 'post_history', 'post_goal', 'memory', 'content'] as const) expect(host.textContent).toContain(en.feedReview[dimension]);
    expect(host.textContent).toContain(en.feedReview.stale);
    await click(en.feedReview.openSummary); expect(onThread).toHaveBeenCalledWith('summary');
    expect(button(en.feedReview.continueHistory).disabled).toBe(true);
    act(() => root.render(<FeedReview workspaceId="fixture" revision={2} actions={actions} onCommand={vi.fn()} onThread={onThread} disabled={false} offline={false} snapshot={snapshot} />));
    await click(en.feedReview.continueHistory); expect(actions.start).toHaveBeenCalledWith('run');
  });
  it('scenario 19: offline, unsynced and unknown-outcome states never silently launch or retry checks', async () => {
    const actions = reviewActions();
    act(() => root.render(<FeedReview workspaceId="fixture" revision={2} actions={actions} onCommand={vi.fn()} onThread={vi.fn()} disabled offline />));
    expect(button(en.feedCollaboration.review).disabled).toBe(true); expect(host.textContent).toContain(en.feedReview.offline);
    act(() => root.render(<FeedReview workspaceId="fixture" revision={2} actions={actions} onCommand={vi.fn()} onThread={vi.fn()} disabled={false} offline={false} snapshot={{ copy: null, threads: [], suggestions: [], runs: [{ id: 'uncertain', kind: 'review', revision: 2, status: 'unknown_outcome', attempts: 1, error: 'provider_outcome_unknown', createdAt: '', coverage: {}, model: 'standard', summaryThreadId: null }] }} />));
    expect(host.textContent).toContain(en.feedReview.unknownExplanation);
    expect([...host.querySelectorAll('button')].some(node => node.textContent === en.feedCollaboration.retry)).toBe(false);
    expect(actions.start).not.toHaveBeenCalled(); expect(actions.action).not.toHaveBeenCalled();
  });
});
function button(label: string) { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent) === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
function panel(overrides: Partial<FeedCommentPanelProps> = {}) {
  return { workspaceId: crypto.randomUUID(), assistantId: crypto.randomUUID(), assistantName: 'Fixture Brian', sessionId: crypto.randomUUID(), composition: composition(), revision: 2, snapshot: { copy: null, threads: [], suggestions: [] }, pending: false, offline: false, readOnly: false, composer: null, onComposer: vi.fn(), selectedThread: null, onThread: vi.fn(), onAskBrian: vi.fn(), onCommand: vi.fn(async () => true), onRefresh: vi.fn(), ...overrides } satisfies FeedCommentPanelProps;
}
describe('[COMP:app-web/feed-editor-toolbar] selected-passage controls', () => {
  function renderEditor(readOnly = false) {
    const doc = composition(); const onEdit = vi.fn();
    act(() => root.render(<CompositionEditor composition={doc} readOnly={readOnly} threads={[]} onEdit={onEdit} onSelection={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    return { doc, onEdit, view: editorView(host.querySelector<HTMLElement>('[contenteditable]')!)! };
  }
  async function menuItem(label: string) {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === label);
    expect(item, label).toBeDefined();
    await act(async () => item!.click());
  }
  it('tracks formatting and supports keyboard movement between named icon controls', async () => {
    const { view, onEdit } = renderEditor();
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))));
    await click(text.bold);
    expect(button(text.bold).getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('strong')?.textContent).toBe('First');
    expect(onEdit).toHaveBeenCalledOnce();
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 12))));
    expect(button(text.bold).getAttribute('aria-pressed')).toBe('false');
    act(() => { button(text.bold).focus(); button(text.bold).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(document.activeElement).toBe(button(text.italic));
  });
  it('opening Insert does not edit; converting a duplicate phrase keeps the selected block identity', async () => {
    const { view, doc, onEdit } = renderEditor();
    let position = 0; view.state.doc.forEach((_, offset, index) => { if (index === 2) position = offset + 1; });
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position + 4, position + 15))));
    await click(text.insert);
    expect(onEdit).not.toHaveBeenCalled();
    await menuItem(en.feedGeneration.convertText);
    expect(onEdit).toHaveBeenCalledOnce();
    const converted = applyFeedEdits(doc, onEdit.mock.calls[0]![0]).composition;
    expect(converted.segments[0]!.content[1]).toEqual(doc.segments[0]!.content[1]);
    expect(converted.segments[0]!.content.find(node => node.type === 'generationPlaceholder')).toMatchObject({ attrs: { brief: 'same phrase' } });
    expect(converted.segments[0]!.content.some(node => node.attrs.id === doc.segments[0]!.content[2]!.attrs.id)).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(view.dom));
  });
  it('the block menu duplicates the selected paragraph rather than the first matching text', async () => {
    const { view, doc, onEdit } = renderEditor();
    let position = 0; view.state.doc.forEach((_, offset, index) => { if (index === 2) position = offset + 1; });
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position))));
    await click(text.blockMenu); expect(onEdit).not.toHaveBeenCalled();
    await menuItem(text.duplicate);
    expect(onEdit.mock.calls[0]![0]).toEqual([expect.objectContaining({ kind: 'insertBlock', afterId: doc.segments[0]!.content[2]!.attrs.id })]);
  });
  it('read-only viewers cannot open mutation menus or apply formatting', () => {
    const { onEdit } = renderEditor(true);
    for (const label of [text.bold, text.insert, text.blockMenu]) expect(button(label).disabled).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('[COMP:app-web/feed-composition-editor] authoring and collaboration workflow', () => {
  it('keeps the writing surface borderless while toolbar controls retain keyboard focus', () => {
    act(() => root.render(<CompositionEditor composition={composition()} threads={[]} onEdit={vi.fn()} onSelection={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    // Execute the scoped CSS selectors against the rendered DOM.
    const css = readFileSync(resolve(import.meta.dirname, '../composition-editor.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selector, declarations]) => ({
      // jsdom has no input-modality model; the browser walkthrough checks
      // :focus-visible with real Tab, arrow and Escape key events.
      selector: selector!.trim().replace(/:global\(([^)]+)\)/g, '$1').replace(/\.(canvas|surface)\b/g, (_, key: string) => `.${editorStyles[key]}`).replaceAll(':focus-visible', ':focus'),
      declarations: declarations!,
    }));
    expect(rules.some(rule => /border-color:\s*var\(--ring\)/.test(rule.declarations))).toBe(false);
    const surfaceRule = rules.find(rule => /ProseMirror.*:focus/.test(rule.selector))!;
    expect(surfaceRule.declarations).toMatch(/box-shadow:\s*none/);
    expect(surfaceRule.declarations).toMatch(/outline:\s*none/);
    const buttonRule = rules.find(rule => /outline:\s*2px solid/.test(rule.declarations))!;
    const frame = host.querySelector<HTMLElement>('[data-feed-segment-editor]')!;
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    expect(frame.className).not.toMatch(/border|shadow|ring|rounded/);
    act(() => view.focus());
    expect(view.dom.matches(surfaceRule.selector)).toBe(true);
    act(() => button(text.bold).focus());
    expect(view.dom.matches(surfaceRule.selector)).toBe(false);
    expect(button(text.bold).matches(buttonRule.selector)).toBe(true);
    act(() => button(text.bold).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(button(text.italic));
    expect(view.dom.matches(surfaceRule.selector)).toBe(false);
    expect(button(text.italic).matches(buttonRule.selector)).toBe(true);
    expect(frame.className).not.toMatch(/border|shadow|ring|rounded/);
    act(() => view.focus());
    expect(view.dom.matches(surfaceRule.selector)).toBe(true);
    expect(button(text.italic).matches(buttonRule.selector)).toBe(false);
  });
  it('retains newer typing and caret through intermediate save acknowledgements and a local save failure', () => {
    const doc = composition(); const emitted: FeedEdit[][] = [];
    const props = { composition: doc, threads: [], onEdit: (edits: FeedEdit[]) => emitted.push(edits), onSelection: vi.fn(), onAction: vi.fn(), onOpenThread: vi.fn() };
    act(() => root.render(<CompositionEditor {...props} />));
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    act(() => { view.focus(); view.dispatch(view.state.tr.insertText('New ', 1)); });
    const first = applyFeedEdits(doc, emitted[0]!).composition;
    act(() => view.dispatch(view.state.tr.insertText('draft ', 5)));
    const latest = applyFeedEdits(first, emitted[1]!).composition;
    const caret = view.state.selection.from;
    act(() => root.render(<CompositionEditor {...props} composition={first} pendingLocalSave />));
    expect(view.state.doc.textContent).toContain('New draft First');
    expect(view.state.selection.from).toBe(caret);
    // Failed persistence also keeps the pending flag until recovery succeeds.
    act(() => root.render(<CompositionEditor {...props} composition={doc} pendingLocalSave />));
    expect(view.state.doc.textContent).toContain('New draft First');
    act(() => root.render(<CompositionEditor {...props} composition={latest} pendingLocalSave={false} />));
    expect(view.state.selection.from).toBe(caret);
    act(() => view.dispatch(view.state.tr.insertText('kept ', caret)));
    expect(() => applyFeedEdits(latest, emitted[2]!)).not.toThrow();
  });
  it('immediately displays queued toolbar changes when there is no unacknowledged typing', () => {
    const doc = composition(); const props = { composition: doc, threads: [], onEdit: vi.fn(), onSelection: vi.fn(), onAction: vi.fn(), onOpenThread: vi.fn() };
    act(() => root.render(<CompositionEditor {...props} />));
    const changed = structuredClone(doc);
    const first = changed.segments[0]!.content[0]!;
    changed.segments[0]!.content[0] = { type: 'heading', attrs: { id: first.attrs.id, level: 2 }, content: [{ type: 'text', text: 'Queued heading' }] };
    act(() => root.render(<CompositionEditor {...props} composition={changed} pendingLocalSave />));
    expect(host.querySelector('h2')?.textContent).toBe('Queued heading');
  });
  it('scenarios 1 and 2: keyboard selection names the second duplicate and comment creation keeps its decoration', async () => {
    const doc = composition(); let selected: FeedTarget | undefined;
    const onSelection = vi.fn((selection) => { selected = selection.target; }); const onAction = vi.fn();
    const props = { composition: doc, threads: [], onEdit: vi.fn(), onSelection, onAction, onOpenThread: vi.fn() };
    act(() => root.render(<CompositionEditor {...props} />));
    const node = host.querySelector<HTMLElement>('[contenteditable=true]')!; const view = editorView(node)!;
    let pos = 0; view.state.doc.forEach((child, offset, index) => { if (index === 2) pos = offset + 1; });
    act(() => { view.focus(); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 4, pos + 15))); });
    expect(selected).toEqual({ kind: 'range', spans: [{ segmentId: doc.segments[0]!.id, blockId: doc.segments[0]!.content[2]!.attrs.id, from: 4, to: 15 }] });
    await click(text.comment); expect(onAction).toHaveBeenCalledWith('comment');
    act(() => root.render(<CompositionEditor {...props} draftAnchor={createFeedAnchor(doc, selected!, 2)} />));
    expect(host.querySelector('[data-feed-thread=draft]')?.textContent).toBe('same phrase');
    expect(host.querySelectorAll('[data-feed-thread=draft]')).toHaveLength(1);
  });
  it('shows passage actions only for a focused selection, with a persistent toolbar fallback', async () => {
    const onAction = vi.fn();
    act(() => root.render(<CompositionEditor composition={composition()} threads={[]} onEdit={vi.fn()} onSelection={vi.fn()} onAction={onAction} onOpenThread={vi.fn()} />));
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))));
    expect(host.querySelector('[data-feed-selection-actions]')).toBeNull();
    act(() => { view.focus(); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))); });
    expect(host.querySelector('[data-feed-selection-actions]')).not.toBeNull();
    act(() => view.dom.blur());
    expect(host.querySelector('[data-feed-selection-actions]')).toBeNull();
    await click(text.documentActions);
    const action = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === text.comment)!;
    await act(async () => action.click());
    expect(onAction).toHaveBeenCalledWith('comment');
  });
  it.each([false, true])('keeps passage actions steady while a selection grows and shrinks (backward: %s)', backward => {
    const onSelection = vi.fn();
    act(() => root.render(<CompositionEditor composition={composition()} threads={[]} onEdit={vi.fn()} onSelection={onSelection} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    // Distinct line geometry exposes movement that jsdom cannot lay out itself.
    const coords = vi.spyOn(view, 'coordsAtPos').mockImplementation(pos => ({ top: 200 + pos * 4, bottom: 220 + pos * 4, left: 0, right: 0 }));
    const anchor = backward ? 48 : 1;
    const heads = backward ? [43, 1, 46] : [6, 40, 4];
    const tops: string[] = []; const quotes: string[] = [];
    for (const head of heads) {
      act(() => { view.focus(); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head))); });
      const actions = host.querySelector<HTMLElement>('[data-feed-selection-actions]')!;
      tops.push(actions.parentElement!.style.top);
      quotes.push(onSelection.mock.lastCall![0].quote);
    }
    expect(tops[0]).not.toBe('');
    expect(new Set(tops).size).toBe(1);
    // The menu stays outside the highlighted range in either direction.
    if (backward) expect(Number.parseFloat(tops[0]!)).toBeGreaterThan(220 + anchor * 4);
    else expect(Number.parseFloat(tops[0]!)).toBeLessThan(200 + anchor * 4);
    expect(quotes[1]!.length).toBeGreaterThan(quotes[0]!.length);
    expect(quotes[2]!.length).toBeLessThan(quotes[0]!.length);
    coords.mockRestore();
  });
  it('scenario 1: typing emits preimage commands that preserve formatted unselected content', () => {
    const doc = composition(); const onEdit = vi.fn();
    act(() => root.render(<CompositionEditor composition={doc} threads={[]} onEdit={onEdit} onSelection={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    act(() => view.dispatch(view.state.tr.insertText('New: ', 1)));
    const edits: FeedEdit[] = onEdit.mock.calls[0]![0];
    expect(edits[0]).toMatchObject({ kind: 'replaceText', spans: [{ from: 0, to: 0 }], preimage: [[]] });
    expect(projectFeed(applyFeedEdits(doc, edits).composition).text).toBe('New: First paragraph.\n\nThe same phrase.\n\nThe same phrase.');
  });
  it('scenarios 1 and 2: list formatting preserves the original block and its comment anchor', async () => {
    const doc = composition(); const segment = doc.segments[0]!; const anchor = createFeedAnchor(doc, { kind: 'range', spans: [{ segmentId: segment.id, blockId: segment.content[0]!.attrs.id, from: 0, to: 5 }] }, 2); const onEdit = vi.fn();
    act(() => root.render(<CompositionEditor composition={doc} threads={[]} draftAnchor={anchor} onEdit={onEdit} onSelection={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    await click(text.bulletList);
    const edits: FeedEdit[] = onEdit.mock.calls[0]![0]; expect(edits[0]!.kind).toBe('reshapeSegment');
    const applied = applyFeedEdits(doc, edits, [anchor]); expect(applied.anchors[0]).toEqual(anchor);
    expect(host.querySelector('li')?.textContent).toBe('First paragraph.');
    expect(host.querySelector('[data-feed-thread=draft]')?.textContent).toBe('First');
  });
  it('scenario 1: a composer creates no thread until the first submitted message', async () => {
    const props = panel(); const target = { kind: 'post' as const }; const composer = { kind: 'comment' as const, anchor: createFeedAnchor(props.composition, target, 2) };
    act(() => root.render(<DraftCommentPanel {...props} composer={composer} />));
    expect(props.onCommand).not.toHaveBeenCalled();
    const input = host.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'A human discussion'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(props.onCommand).toHaveBeenCalledWith([expect.objectContaining({ kind: 'comment', target, text: 'A human discussion' })]);
    expect(host.querySelector('[data-chat-session]')).toBeNull();
  });
  it('scenarios 1 and 3: before/after decisions never edit until Accept and retain Undo after acceptance', async () => {
    const props = panel(); const suggestionId = crypto.randomUUID(); const edits = proposeFeedReplacement(props.composition, { kind: 'post' }, 'Proposed body');
    const suggestion = { id: suggestionId, edits, rationale: 'Use a concrete point', status: 'proposed', threadId: null, parentId: null, sourceRevision: 2, authorUserId: crypto.randomUUID(), authorKind: 'assistant' as const };
    act(() => root.render(<DraftCommentPanel {...props} snapshot={{ ...props.snapshot!, suggestions: [suggestion] }} />));
    expect(props.onCommand).not.toHaveBeenCalled(); expect(host.textContent).toContain('First paragraph.'); expect(host.textContent).toContain('Proposed body');
    await click(text.accept); expect(props.onCommand).toHaveBeenCalledWith([{ kind: 'decide', suggestionId, outcome: 'accepted', reasonThreadId: undefined }], edits);
    act(() => root.render(<DraftCommentPanel {...props} snapshot={{ ...props.snapshot!, suggestions: [{ ...suggestion, status: 'accepted', acceptanceReceipt: { revision: 3 } }] }} />));
    await click(text.undo); expect(props.onCommand).toHaveBeenLastCalledWith([{ kind: 'undo', revision: 3 }]);
  });
  it('scenarios 2 and 10: detached discussion stays available with keyboard-operable reattach and resolution', async () => {
    const props = panel(); const thread = { id: crypto.randomUUID(), transcriptSessionId: crypto.randomUUID(), anchor: { ...createFeedAnchor(props.composition, { kind: 'post' }, 2), quote: 'Removed passage', state: 'detached' as const }, resolved: false, authorUserId: crypto.randomUUID(), authorKind: 'user' as const, createdAt: new Date().toISOString() };
    const target = { kind: 'block' as const, segmentId: props.composition.segments[0]!.id, blockId: props.composition.segments[0]!.content[0]!.attrs.id };
    act(() => root.render(<DraftCommentPanel {...props} selectedThread={thread.id} selection={target} snapshot={{ ...props.snapshot!, threads: [thread] }} />));
    expect(host.textContent).toContain(text.detached); await click(text.reattach);
    expect(props.onCommand).toHaveBeenCalledWith([{ kind: 'reattach', threadId: thread.id, target }]);
    await click(text.resolve); expect(props.onCommand).toHaveBeenLastCalledWith([{ kind: 'resolve', threadId: thread.id, resolved: true }]);
  });
  it('a focused comment shows only its discussion and related suggestions', () => {
    const props = panel(); const first = { id: 'first', transcriptSessionId: 'first-chat', anchor: createFeedAnchor(props.composition, { kind: 'post' }, 2), resolved: false, authorUserId: 'member', authorKind: 'user' as const, createdAt: '' };
    const edits = proposeFeedReplacement(props.composition, { kind: 'post' }, 'A proposal');
    const suggestion = { id: 'proposal', edits, rationale: 'Use a concrete point', status: 'proposed', threadId: 'first', parentId: null, sourceRevision: 2, authorUserId: 'member', authorKind: 'assistant' as const };
    act(() => root.render(<DraftCommentPanel {...props} focused selectedThread="first" snapshot={{ ...props.snapshot!, threads: [first, { ...first, id: 'second' }], suggestions: [suggestion, { ...suggestion, id: 'unrelated', threadId: 'second' }] }} />));
    expect(host.querySelectorAll('[data-feed-comment-id]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-feed-suggestion]')).toHaveLength(1);
    expect(host.querySelector('[data-feed-suggestion="unrelated"]')).toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Comments"]')).toBeNull();
  });
  it('the styled Reply button submits the attributed comment form', async () => {
    const props = panel();
    const thread = { id: crypto.randomUUID(), transcriptSessionId: crypto.randomUUID(), anchor: createFeedAnchor(props.composition, { kind: 'post' }, 2), resolved: false, authorUserId: crypto.randomUUID(), authorKind: 'user' as const, createdAt: '' };
    act(() => root.render(<DraftCommentPanel {...props} selectedThread={thread.id} snapshot={{ ...props.snapshot!, threads: [thread] }} />));
    const input = host.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'A useful clarification'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(text.reply);
    expect(props.onCommand).toHaveBeenCalledWith([{ kind: 'reply', threadId: thread.id, text: 'A useful clarification' }]);
    expect(input.value).toBe('');
  });
  it('opens Brian in the shared chat without replacing the selected comment or mounting an inline chat', async () => {
    const props = panel();
    const thread = { id: crypto.randomUUID(), transcriptSessionId: crypto.randomUUID(), anchor: createFeedAnchor(props.composition, { kind: 'post' }, 2), resolved: false, authorUserId: crypto.randomUUID(), authorKind: 'user' as const, createdAt: new Date().toISOString() };
    act(() => root.render(<DraftCommentPanel {...props} selectedThread={thread.id} snapshot={{ ...props.snapshot!, threads: [thread] }} />));
    await click(text.askBrian);
    expect(props.onAskBrian).toHaveBeenCalledWith(thread.id);
    expect(props.onThread).not.toHaveBeenCalled();
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(host.querySelector('textarea[aria-label="Reply"]')).not.toBeNull();
    expect(host.querySelector('[data-chat-session]')).toBeNull();
  });
  it('scenario 10: cold loading, failed reads, cached offline discussion and pending edits remain distinct', () => {
    const props = panel({ loading: true, snapshot: null }); act(() => root.render(<DraftCommentPanel {...props} />));
    expect(host.textContent).not.toContain(text.noComments);
    act(() => root.render(<DraftCommentPanel {...props} loading={false} error={new Error('offline')} />));
    expect(host.querySelector('[role=alert]')?.textContent).toContain(text.loadFailed);
    act(() => root.render(<DraftCommentPanel {...props} loading={false} snapshot={{ copy: null, threads: [], suggestions: [] }} offline pending />));
    expect(host.textContent).toContain(text.pending); expect(button(text.comment).disabled).toBe(true);
  });
});


function generationControls(): FeedGenerationControls { return { workspaceId: crypto.randomUUID(), assistantId: crypto.randomUUID(), sessionId: crypto.randomUUID(), revision: 2, offline: false, pending: false, readOnly: false, article: false, snapshot: { copy: null, threads: [], suggestions: [] }, onCommand: vi.fn(async () => true), onRefresh: vi.fn() }; }
const generationSlot = (): FeedPlaceholderAttrs => ({ id: crypto.randomUUID(), kind: 'text', brief: 'Explain irrigation.', briefRevision: 0, references: [] });
describe('[COMP:app-web/feed-generation-placeholder] slot workflow', () => {
  it('keeps a saved marker compact while drafting; opening and closing its options never starts generation', async () => {
    const slot = generationSlot(); const onEdit = vi.fn(); const onContinue = vi.fn();
    act(() => root.render(<GenerationPlaceholder slot={slot} segmentId={crypto.randomUUID()} controls={generationControls()} onEdit={onEdit} onSelect={vi.fn()} onContinue={onContinue} onAction={vi.fn()} />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain(en.feedGeneration.generate);
    const field = host.querySelector<HTMLInputElement>('input')!;
    expect(field.value).toBe(slot.brief);
    act(() => { field.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'A diagram for later.'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onEdit).toHaveBeenCalledWith([expect.objectContaining({ replacement: [expect.objectContaining({ attrs: expect.objectContaining({ brief: 'A diagram for later.', briefRevision: 1 }) })] })]);
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onContinue).toHaveBeenCalledOnce();
    await click(en.feedGeneration.openDetails);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(button(en.feedGeneration.generate).disabled).toBe(false);
    await click(en.feedGeneration.closeDetails);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(host.querySelector('[data-feed-slot]')).toBeTruthy();
    expect(state.http).not.toHaveBeenCalled();
  });
  it.each(['text', 'image'] as const)('lets /%s plus a brief mark a gap and continue typing after it without any generation request', kind => {
    const doc = importLegacyFeed({ text: `Opening paragraph.\n\n/${kind} Explain the framework`, postFormat: 'post', threadSegments: [], media: [] });
    const onEdit = vi.fn(); const props = { generation: generationControls(), threads: [], onEdit, onSelection: vi.fn(), onAction: vi.fn(), onOpenThread: vi.fn() };
    act(() => root.render(<CompositionEditor {...props} composition={doc} />));
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc))); view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key: 'Enter' }))); });
    const inserted = applyFeedEdits(doc, onEdit.mock.calls[0]![0]).composition;
    expect(inserted.segments[0]!.content).toHaveLength(3);
    expect(inserted.segments[0]!.content[0]).toEqual(doc.segments[0]!.content[0]);
    expect(inserted.segments[0]!.content[1]).toMatchObject({ type: 'generationPlaceholder', attrs: { kind, brief: 'Explain the framework' } });
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    act(() => view.dispatch(view.state.tr.insertText('Continue the draft.')));
    const continued = applyFeedEdits(inserted, onEdit.mock.calls[1]![0]).composition;
    expect(continued.segments[0]!.content[1]).toEqual(inserted.segments[0]!.content[1]);
    expect(projectFeed(continued).text).toContain('Continue the draft.');
    act(() => root.render(<CompositionEditor {...props} composition={continued} />));
    expect(host.querySelector('input')?.value).toBe('Explain the framework');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(state.http).not.toHaveBeenCalled();
  });
  it('Enter in a saved end-of-document brief creates a following paragraph and leaves the marker intact', () => {
    const doc = composition(); const slot = generationSlot(); doc.segments[0]!.content = [{ type: 'generationPlaceholder', attrs: slot }];
    const onEdit = vi.fn();
    act(() => root.render(<CompositionEditor composition={doc} generation={generationControls()} threads={[]} onEdit={onEdit} onSelection={vi.fn()} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    const field = host.querySelector<HTMLInputElement>('input')!;
    act(() => { field.focus(); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    expect(document.activeElement).toBe(view.dom);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    const changed = applyFeedEdits(doc, onEdit.mock.calls[0]![0]).composition;
    expect(changed.segments[0]!.content[0]).toEqual(doc.segments[0]!.content[0]);
    expect(changed.segments[0]!.content[1]).toMatchObject({ type: 'paragraph', content: [] });
    expect(state.http).not.toHaveBeenCalled();
  });
  it('scenarios 4 and 10: manual fill works offline, advances typed history, and never calls a model', async () => {
    const slot = generationSlot(); const onEdit = vi.fn(); const controls = { ...generationControls(), offline: true };
    act(() => root.render(<GenerationPlaceholder slot={slot} segmentId={crypto.randomUUID()} controls={controls} onEdit={onEdit} onSelect={vi.fn()} onAction={vi.fn()} />));
    await click(en.feedGeneration.openDetails);
    expect(button(en.feedGeneration.generate).disabled).toBe(true);
    const field = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${en.feedGeneration.manualText}"]`)!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'A hand-written explanation.'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(en.feedGeneration.fillText);
    expect(onEdit).toHaveBeenCalledWith([expect.objectContaining({ kind: 'replaceBlock', blockId: slot.id, replacement: [expect.objectContaining({ type: 'paragraph', attrs: { id: slot.id } })] })]);
    expect(state.http).not.toHaveBeenCalled();
  });
  it('scenarios 4 and 8: displays the estimate before dispatch and reuses its mutation ID after a lost response', async () => {
    const slot = generationSlot(); const controls = generationControls(); const segmentId = crypto.randomUUID();
    const estimate: FeedGenerationEstimate = { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(), revision: 2, segmentId, slot, count: 1, model: 'fixture-model', tier: 'standard', price: { currency: 'USD', maximumUsd: 0.012, rateVersion: 'fixture', billing: 'included' }, inputCharacters: 500, maxTokens: 1000, sources: [], omissions: ['source_unavailable'], confirmationRequired: true };
    state.http.mockResolvedValueOnce({ ok: true, json: async () => ({ estimate }) });
    act(() => root.render(<GenerationPlaceholder slot={slot} segmentId={segmentId} controls={controls} onEdit={vi.fn()} onSelect={vi.fn()} onAction={vi.fn()} />));
    await click(en.feedGeneration.openDetails);
    expect(state.http).not.toHaveBeenCalled();
    await click(en.feedGeneration.generate);
    expect(state.http).toHaveBeenCalledTimes(1); expect(state.http.mock.calls[0]![0]).toContain('/generations/estimate');
    expect(document.body.textContent).toContain('$0.012'); expect(document.body.textContent).toContain(en.feedGeneration.referenceOmissions); expect(document.body.textContent).toContain(slot.brief);
    state.http.mockRejectedValueOnce(new Error('Lost response'));
    await click(en.feedGeneration.confirm);
    const first = JSON.parse(state.http.mock.calls[1]![1].body);
    expect(first).toMatchObject({ estimateId: estimate.id, confirmed: true });
    state.http.mockResolvedValueOnce({ ok: true, json: async () => ({ run: { id: 'retained' } }) });
    await click(en.feedGeneration.confirm);
    expect(JSON.parse(state.http.mock.calls[2]![1].body)).toEqual(first);
    expect(controls.onCommand).not.toHaveBeenCalled();
  });
  it('scenarios 5 and 8: stale candidates remain visible with Keep for later and cannot overwrite a changed slot', async () => {
    const slot = generationSlot(); const controls = generationControls(); const segmentId = crypto.randomUUID();
    const candidate = { id: crypto.randomUUID(), sourceRunId: crypto.randomUUID(), sourceRevision: 1, edits: [{ kind: 'replaceBlock' as const, segmentId, blockId: slot.id, preimage: { type: 'generationPlaceholder' as const, attrs: { ...slot, brief: 'Older brief.' } }, replacement: [{ type: 'paragraph' as const, attrs: { id: slot.id }, content: [{ type: 'text' as const, text: 'Retained candidate.' }] }] }], rationale: 'Earlier request.', status: 'proposed', threadId: null, parentId: null, authorUserId: 'fixture', authorKind: 'assistant' as const };
    act(() => root.render(<FeedGenerationResults controls={controls} runs={[]} candidates={[candidate]} slot={slot} onRunAction={vi.fn()} />));
    expect(host.textContent).toContain('Retained candidate.'); expect(host.textContent).toContain(en.feedGeneration.stale); expect(button(en.feedCollaboration.accept).disabled).toBe(true);
    await click(en.feedGeneration.keepLater);
    expect(controls.onCommand).toHaveBeenCalledWith([{ kind: 'decide', suggestionId: candidate.id, outcome: 'deferred' }]);
  });
  it('scenarios 4 and 6: the slash shortcut creates a real slot and the portal preserves block selection for touch controls', async () => {
    const doc = importLegacyFeed({ text: '/text', postFormat: 'post', threadSegments: [], media: [] }); const onEdit = vi.fn(); const onSelection = vi.fn(); const controls = generationControls();
    act(() => root.render(<CompositionEditor composition={doc} threads={[]} generation={controls} onEdit={onEdit} onSelection={onSelection} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    const view = editorView(host.querySelector<HTMLElement>('[contenteditable=true]')!)!;
    act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc))); view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key: 'Enter' }))); });
    expect(onEdit).toHaveBeenCalledOnce(); const changed = applyFeedEdits(doc, onEdit.mock.calls[0]![0]).composition;
    act(() => root.render(<CompositionEditor composition={changed} threads={[]} generation={controls} onEdit={onEdit} onSelection={onSelection} onAction={vi.fn()} onOpenThread={vi.fn()} />));
    const field = host.querySelector<HTMLInputElement>(`input[aria-label="${en.feedGeneration.brief}"]`)!; expect(field).toBeTruthy();
    act(() => field.focus());
    expect(onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'block', segmentId: changed.segments[0]!.id, blockId: changed.segments[0]!.content[0]!.attrs.id } }));
    expect(state.http).not.toHaveBeenCalled();
  });
});

describe('[COMP:app-web/feed-generation-placeholder] durable image review', () => {
  it('scenarios 4 and 10: image previews use authenticated bytes and keep the accepted outline order', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture-image') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    state.image.mockResolvedValue(new Blob(['fixture'], { type: 'image/png' }));
    const doc = composition(); const fileId = crypto.randomUUID(); doc.segments[0]!.content.splice(1, 0, { type: 'image', attrs: { id: crypto.randomUUID(), fileId, mimeType: 'image/png', alt: 'Orchard diagram', placement: 'inline' } });
    await act(async () => root.render(<FeedCompositionPreview composition={doc} workspaceId="fixture-workspace" />));
    const image = host.querySelector('img')!; expect(image.alt).toBe('Orchard diagram'); expect(image.src).toBe('blob:fixture-image'); expect(state.image).toHaveBeenCalledWith('fixture-workspace', fileId);
    const section = host.querySelector('section')!; expect([...section.children].map(node => node.tagName)).toEqual(['P', 'FIGURE', 'P', 'P']);
    expect(projectFeed(doc).media[0]!.fileId).toBe(fileId); expect(JSON.stringify(doc)).not.toContain('blob:');
  });
  it('scenario 8: missing image bytes show an explicit recovery state rather than a fabricated preview', async () => {
    state.image.mockRejectedValue(new Error('Denied')); const doc = composition(); doc.segments[0]!.content = [{ type: 'image', attrs: { id: crypto.randomUUID(), fileId: crypto.randomUUID(), mimeType: 'image/png', alt: 'Source diagram', placement: 'inline' } }];
    await act(async () => root.render(<FeedCompositionPreview composition={doc} workspaceId="fixture" />));
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain(en.feedGeneration.imageUnavailable);
  });
});

import { FeedLearnedDecisions, type FeedLearningActions } from '../feed-learned-decisions';
import type { FeedLearnedDecisions as Learned } from '@use-brian/shared';
vi.mock('@/components/ui/confirm-dialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/components/chrome/surface-skeleton', () => ({ ListSurfaceSkeleton: () => <div data-learning-skeleton /> }));
function learningActions(): FeedLearningActions { return { busy: false, error: false, confirm: vi.fn(async () => true), command: vi.fn(async () => true), retry: vi.fn(async () => true) }; }
function learningData(): Learned {
  return { canConfirm: true, privateSourcesOmitted: false, sources: [{ id: 'source', sessionId: 'draft', actorUserId: 'author', actorName: 'Fixture author', canRetract: true, eventKind: 'feed.draft_revised', revision: 2, outcome: 'revised', threadId: 'reason' }], confirmations: [{ id: 'confirmation', revision: 2, actorUserId: 'author', createdAt: '', priorConfirmationId: null, reviewRunId: 'review', current: true, revoked: false, run: { id: 'learning-run', kind: 'confirmation_learning', revision: 2, status: 'succeeded', attempts: 1, error: null, createdAt: '', model: 'background', summaryThreadId: null, coverage: {} }, summary: { id: 'summary', sourceEventIds: ['source'], postOnly: false, text: 'A concrete orchard example was kept.', correction: null, canEdit: true, decisions: [{ statement: 'A promotional opening was rejected for this post.', actorUserId: 'author', outcome: 'rejected', sourceIds: ['source'] }], conflicts: [{ statement: 'No shared universal preference was established.', sourceIds: ['source'] }], unresolved: ['Which audience should the next post address?'] }, artifacts: [{ id: 'rule', kind: 'rule', text: 'Use observable openings.', status: 'suggested', actorUserId: 'author', scope: { platform: 'threads', postFormat: 'post', brandId: null, sensitivity: 'internal', compartments: [], projectIds: [] }, canEdit: true, canPromote: true, erased: false, sourceEventIds: ['source'] }], coverage: { included: 3, eligible: 5, omitted: 2 } }] };
}
function learnedPanel(data: Learned | null = learningData(), actions = learningActions()) { return { workspaceId: 'workspace', sessionId: 'draft', platform: 'threads' as const, revision: 2, data, actions, loading: false, disabled: false, offline: false, unfinished: false, onRefresh: vi.fn(), onThread: vi.fn(), reviewRunId: 'review' }; }
describe('[COMP:app-web/feed-learned-decisions] confirmation and correction controls', () => {
  it('scenarios 12-13 and 20: explicitly confirms the exact post with the considered Review, separately from delivery', async () => {
    const props = learnedPanel({ ...learningData(), confirmations: [] });
    act(() => root.render(<FeedLearnedDecisions {...props} />));
    expect(host.textContent).toContain(en.feedLearning.notConfirmed);
    await click(en.feedLearning.confirm); expect(props.actions.confirm).toHaveBeenCalledWith('review'); expect(props.actions.command).not.toHaveBeenCalled();
    act(() => root.render(<FeedLearnedDecisions {...props} data={learningData()} />));
    expect(button(en.feedLearning.confirm).disabled).toBe(true);
  });
  it('scenarios 11 and 13-15: exposes summary, conflicts, coverage, exact source and typed governance', async () => {
    const props = learnedPanel(); act(() => root.render(<FeedLearnedDecisions {...props} />));
    expect(host.textContent).toContain('3/5'); expect(host.textContent).toContain('No shared universal preference');
    await click(en.feedLearning.openSource); expect(props.onThread).toHaveBeenCalledWith('reason');
    await click(en.feedLearning.approve); expect(props.actions.command).toHaveBeenLastCalledWith('confirmation', { action: 'decideRule', ruleId: 'rule', decision: 'approve' });
    await click(en.feedLearning.retract); expect(props.actions.command).toHaveBeenLastCalledWith('confirmation', { action: 'retractSource', eventId: 'source' });
    await click(en.feedLearning.revoke); expect(props.actions.command).toHaveBeenLastCalledWith('confirmation', { action: 'revoke' });
  });
  it('scenario 15: Remember and corrections have keyboard forms and preserve the entered instruction', async () => {
    const props = learnedPanel(); act(() => root.render(<FeedLearnedDecisions {...props} />));
    await click(en.feedLearning.remember);
    const field = host.querySelector('textarea')!; expect(document.activeElement).toBe(field);
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Use a concrete example in future openings.'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(props.actions.command).toHaveBeenLastCalledWith('confirmation', { action: 'remember', rule: 'Use a concrete example in future openings.' });
    expect(host.querySelector('form')).toBeNull();
    await click(en.feedLearning.edit); expect(host.querySelectorAll('textarea')).toHaveLength(2);
    await click(en.feedLearning.save); expect(props.actions.command).toHaveBeenLastCalledWith('confirmation', expect.objectContaining({ action: 'editSummary', summary: 'A concrete orchard example was kept.' }));
  });
  it('scenarios 7-8 and 15: loading, offline, unfinished, denied and failed states never silently confirm', async () => {
    const props = learnedPanel(null); act(() => root.render(<FeedLearnedDecisions {...props} loading />)); expect(host.querySelector('[data-learning-skeleton]')).toBeTruthy(); expect(button(en.feedLearning.confirm).disabled).toBe(true);
    for (const state of [{ offline: true }, { disabled: true }, { unfinished: true }, { error: new Error('unavailable') }]) {
      act(() => root.render(<FeedLearnedDecisions {...props} data={{ ...learningData(), confirmations: [] }} {...state} />)); expect(button(en.feedLearning.confirm).disabled).toBe(true);
    }
    expect(props.actions.confirm).not.toHaveBeenCalled();
    act(() => root.render(<FeedLearnedDecisions {...props} data={{ ...learningData(), canConfirm: false, privateSourcesOmitted: true }} />)); expect(host.textContent).toContain(en.feedLearning.privateOmitted);
    const unknown = learningData(); unknown.confirmations[0]!.run!.status = 'unknown_outcome'; act(() => root.render(<FeedLearnedDecisions {...props} data={unknown} />)); expect(host.textContent).toContain(en.feedReview.unknownExplanation); expect([...host.querySelectorAll('button')].some(node => node.textContent === en.feedCollaboration.retry)).toBe(false);
  });
});
