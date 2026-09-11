// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import type { FeedCommand, FeedEdit, FeedTarget } from '@use-brian/shared';
import { applyFeedEdits, createFeedAnchor, importLegacyFeed, projectFeed, proposeFeedReplacement } from '@use-brian/doc-model';
import { en } from '@/lib/i18n/dictionaries/en';
const state = vi.hoisted(() => ({ messages: { data: { messages: [] }, loading: false, error: undefined, refresh: vi.fn() } }));
vi.mock('@/lib/i18n/client', () => ({ useT: () => en, useLocale: () => 'en' }));
vi.mock('@/lib/surface-cache', () => ({ useCachedResource: () => state.messages }));
vi.mock('@/lib/surface-prefetch', () => ({ feedCollaborationCacheKey: () => 'fixture-collaboration', goalsCacheKey: () => 'fixture-goals' }));
vi.mock('../tuning-chat-panel', () => ({ TuningChatPanel: (props: { sessionId: string }) => <div data-chat-session={props.sessionId} /> }));
import { CompositionEditor } from '../composition-editor';
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
function button(label: string) { const found = [...host.querySelectorAll('button')].find(node => node.textContent === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
function panel(overrides: Partial<FeedCommentPanelProps> = {}) {
  return { workspaceId: crypto.randomUUID(), assistantId: crypto.randomUUID(), assistantName: 'Fixture Brian', sessionId: crypto.randomUUID(), composition: composition(), revision: 2, snapshot: { copy: null, threads: [], suggestions: [] }, pending: false, offline: false, readOnly: false, composer: null, onComposer: vi.fn(), selectedThread: null, onThread: vi.fn(), onCommand: vi.fn(async () => true), onRefresh: vi.fn(), ...overrides } satisfies FeedCommentPanelProps;
}
describe('[COMP:app-web/feed-composition-editor] authoring and collaboration workflow', () => {
  it('scenarios 1 and 2: keyboard selection names the second duplicate and comment creation keeps its decoration', async () => {
    const doc = composition(); let selected: FeedTarget | undefined;
    const onSelection = vi.fn((selection) => { selected = selection.target; }); const onAction = vi.fn();
    const props = { composition: doc, threads: [], onEdit: vi.fn(), onSelection, onAction, onOpenThread: vi.fn() };
    act(() => root.render(<CompositionEditor {...props} />));
    const node = host.querySelector<HTMLElement>('[contenteditable=true]')!; const view = editorView(node)!;
    let pos = 0; view.state.doc.forEach((child, offset, index) => { if (index === 2) pos = offset + 1; });
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 4, pos + 15))));
    expect(selected).toEqual({ kind: 'range', spans: [{ segmentId: doc.segments[0]!.id, blockId: doc.segments[0]!.content[2]!.attrs.id, from: 4, to: 15 }] });
    await click(text.comment); expect(onAction).toHaveBeenCalledWith('comment');
    act(() => root.render(<CompositionEditor {...props} draftAnchor={createFeedAnchor(doc, selected!, 2)} />));
    expect(host.querySelector('[data-feed-thread=draft]')?.textContent).toBe('same phrase');
    expect(host.querySelectorAll('[data-feed-thread=draft]')).toHaveLength(1);
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
  it('scenario 10: cold loading, failed reads, cached offline discussion and pending edits remain distinct', () => {
    const props = panel({ loading: true, snapshot: null }); act(() => root.render(<DraftCommentPanel {...props} />));
    expect(host.textContent).not.toContain(text.noComments);
    act(() => root.render(<DraftCommentPanel {...props} loading={false} error={new Error('offline')} />));
    expect(host.querySelector('[role=alert]')?.textContent).toContain(text.loadFailed);
    act(() => root.render(<DraftCommentPanel {...props} loading={false} snapshot={{ copy: null, threads: [], suggestions: [] }} offline pending />));
    expect(host.textContent).toContain(text.pending); expect(button(text.comment).disabled).toBe(true);
  });
});
