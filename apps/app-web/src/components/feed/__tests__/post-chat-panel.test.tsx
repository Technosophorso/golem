// @vitest-environment jsdom
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedAnchor, importLegacyFeed } from '@use-brian/doc-model';
import { en } from '@/lib/i18n/dictionaries/en';
import type { FeedCommentThread } from '@/lib/feed-collaboration';
import { FeedPostChat } from '../post-chat-panel';

const lifecycle = vi.hoisted(() => ({ unmount: vi.fn() }));
vi.mock('@/lib/i18n/client', () => ({ useT: () => en }));
vi.mock('../tuning-chat-panel', () => ({ TuningChatPanel: (props: { sessionId: string; ready: boolean; feedTarget?: unknown; ownsDockRecorderTarget?: boolean }) => {
  const [input, setInput] = useState('');
  useEffect(() => () => lifecycle.unmount(props.sessionId), [props.sessionId]);
  return <div data-session={props.sessionId} data-target={JSON.stringify(props.feedTarget)} data-recorder-owner={props.ownsDockRecorderTarget}>
    <textarea aria-label={props.sessionId} value={input} disabled={!props.ready} onChange={event => setInput(event.target.value)} />
  </div>;
} }));
import { TuningChatPanel } from '../tuning-chat-panel';
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  lifecycle.unmount.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const doc = importLegacyFeed({ text: 'A concrete opening.', postFormat: 'post', threadSegments: [], media: [] });
const threads: FeedCommentThread[] = ['first', 'second'].map(id => ({ id, transcriptSessionId: `${id}-transcript`,
  anchor: createFeedAnchor(doc, { kind: 'post' }, 4), resolved: false, authorUserId: 'member', authorKind: 'user', createdAt: '' }));
function props() {
  return { workspaceId: 'workspace', assistantId: 'assistant', assistantName: 'Writer', sessionId: 'post', revision: 4,
    ready: true, threads, openedThreadIds: [] as string[], activeThreadId: null as string | null,
    mainChat: <TuningChatPanel sessionId="post" assistantId="assistant" assistantName="Writer" workspaceId="workspace" ready />,
    onWholePost: vi.fn(), onRefresh: vi.fn() };
}
function type(session: string, value: string) {
  const field = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${session}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('[COMP:app-web/feed-post-chat] persistent post and thread conversations', () => {
  it('preserves unsent input and mounted streams while switching between post and thread conversations', () => {
    const base = props();
    act(() => root.render(<FeedPostChat {...base} />));
    type('post', 'An unfinished post question');
    act(() => root.render(<FeedPostChat {...base} openedThreadIds={['first']} activeThreadId="first" />));
    type('first-transcript', 'An unfinished thread question');
    expect(host.querySelector<HTMLElement>('[data-feed-post-conversation]')!.hidden).toBe(true);
    expect(JSON.parse(host.querySelector('[data-session="first-transcript"]')!.getAttribute('data-target')!)).toEqual({ sessionId: 'post', revision: 4, threadId: 'first' });
    act(() => root.render(<FeedPostChat {...base} openedThreadIds={['first', 'second']} activeThreadId="second" />));
    expect(host.querySelector<HTMLElement>('[data-feed-thread-chat="first"]')!.hidden).toBe(true);
    expect(host.querySelector('[data-session="first-transcript"]')!.getAttribute('data-recorder-owner')).toBe('false');
    expect(host.querySelector('[data-session="second-transcript"]')!.getAttribute('data-recorder-owner')).toBe('true');
    act(() => root.render(<FeedPostChat {...base} openedThreadIds={['first', 'second']} activeThreadId="first" />));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="first-transcript"]')!.value).toBe('An unfinished thread question');
    act(() => root.render(<FeedPostChat {...base} openedThreadIds={['first', 'second']} />));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="post"]')!.value).toBe('An unfinished post question');
    expect(lifecycle.unmount).not.toHaveBeenCalled();
  });
  it('returns from selected passage or comment context through the same Whole post action', () => {
    const base = props();
    act(() => root.render(<FeedPostChat {...base} selectionQuote="A selected phrase" />));
    expect(host.querySelector('blockquote')?.textContent).toBe('A selected phrase');
    act(() => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(base.onWholePost).toHaveBeenCalledOnce();
    act(() => root.render(<FeedPostChat {...base} openedThreadIds={['first']} activeThreadId="first" />));
    expect(host.textContent).toContain(en.feedCollaboration.commentConversation);
    expect(host.querySelector('blockquote')?.textContent).toBe(en.feedCollaboration.post);
    act(() => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(base.onWholePost).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role=tablist]')).toBeNull();
  });
  it('disables thread input when the working copy cannot send and falls back to post chat after access data is evicted', () => {
    const base = props();
    act(() => root.render(<FeedPostChat {...base} openedThreadIds={['first']} activeThreadId="first" ready={false} />));
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="first-transcript"]')!.disabled).toBe(true);
    act(() => root.render(<FeedPostChat {...base} threads={[]} openedThreadIds={['first']} activeThreadId="first" ready={false} />));
    expect(host.querySelector('[data-feed-thread-chat]')).toBeNull();
    expect(host.querySelector<HTMLElement>('[data-feed-post-conversation]')!.hidden).toBe(false);
  });
});
