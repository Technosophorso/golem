// @vitest-environment jsdom
import React, { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedAnchor, importLegacyFeed } from '@use-brian/doc-model';
import { FeedDocumentAnnotations } from '../document-annotations';
import { FeedEditorPanel } from '../editor-panel';
import { en } from '@/lib/i18n/dictionaries/en';
import type { FeedCommentThread } from '@/lib/feed-collaboration';
vi.mock('@/lib/i18n/client', () => ({ useT: () => en }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const doc = importLegacyFeed({ text: 'Repeated text.\n\nRepeated text.', postFormat: 'post', threadSegments: [], media: [] });
function thread(id: string, block: number): FeedCommentThread {
  return { id, transcriptSessionId: `${id}-chat`, resolved: false, authorKind: 'user', authorUserId: 'member', createdAt: '',
    anchor: createFeedAnchor(doc, { kind: 'block', segmentId: doc.segments[0]!.id, blockId: doc.segments[0]!.content[block]!.attrs.id }, 2) };
}
describe('[COMP:app-web/feed-document-annotations] stable block markers', () => {
  it('groups comments by identity, follows moved blocks and excludes detached or resolved anchors', async () => {
    const first = doc.segments[0]!.content[0]!.attrs.id; const second = doc.segments[0]!.content[1]!.attrs.id;
    const positions: Record<string, number> = { [first]: 150, [second]: 260 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      return { top: positions[this.dataset.blockId ?? ''] ?? 100, left: 0, width: 700, height: 44 } as DOMRect;
    });
    const documentRef = createRef<HTMLDivElement>(); const onThread = vi.fn();
    const threads = [thread('first', 0), thread('second', 1), thread('third', 1), { ...thread('resolved', 0), resolved: true }, { ...thread('detached', 0), anchor: { ...thread('detached', 0).anchor, state: 'detached' as const } }];
    act(() => root.render(<div><div ref={documentRef}><p data-block-id={first}>Repeated text.</p><figure data-block-id={second}>Repeated text.</figure></div><FeedDocumentAnnotations documentRef={documentRef} threads={threads} onThread={onThread} /></div>));
    expect(host.querySelectorAll('button')).toHaveLength(2);
    const marker = host.querySelector<HTMLButtonElement>('[data-feed-comment-marker="second"]')!;
    expect(marker.textContent).toBe('2'); expect(marker.style.top).toBe('160px');
    act(() => marker.click()); expect(onThread).toHaveBeenCalledWith('second');
    positions[second] = 320;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(marker.style.top).toBe('220px');
    await act(async () => host.querySelector('figure')!.remove());
    expect(host.querySelectorAll('button')).toHaveLength(1);
  });
});
describe('[COMP:app-web/feed-editor-panel] retained editor panels', () => {
  it('retains unsent input on close and returns keyboard focus to its opener', async () => {
    const onClose = vi.fn(); const anchor = document.createElement('button'); host.append(anchor);
    function Content() { const [text, setText] = useState(''); return <textarea aria-label="Reply draft" value={text} onChange={event => setText(event.target.value)} />; }
    const render = async (open: boolean) => { await act(async () => root.render(<FeedEditorPanel open={open} title="Comments" anchor={anchor} onClose={onClose}><Content /></FeedEditorPanel>)); };
    // The opener is outside the rendered root, as it is in the document header.
    document.body.append(anchor); anchor.focus();
    await render(true);
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Reply draft"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Unsent discussion'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await render(false);
    expect(document.querySelector<HTMLElement>('[data-feed-editor-panel]')!.hidden).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(anchor));
    await render(true);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Reply draft"]')!.value).toBe('Unsent discussion');
    await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${en.feedCollaboration.closePanel}"]`)!.click());
    expect(onClose).toHaveBeenCalled(); anchor.remove();
  });
});
