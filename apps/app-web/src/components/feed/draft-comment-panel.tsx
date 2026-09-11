"use client";
/** Anchored discussion and reviewed edits share the composition command path. [COMP:app-web/feed-composition-editor] */
import { useEffect, useState } from 'react';
import type { FeedAnchor, FeedCommand, FeedComposition, FeedEdit, FeedTarget } from '@use-brian/shared';
import { feedText, inlineText, proposeFeedReplacement } from '@use-brian/doc-model';
import { useT } from '@/lib/i18n/client';
import { useCachedResource } from '@/lib/surface-cache';
import { feedCollaborationCacheKey } from '@/lib/surface-prefetch';
import { feedCachedJson, feedPaintFirst, readFeedCachedJson } from '@/lib/offline/feed-cache';
import { feedCollaborationPath, type FeedCollaborationSnapshot, type FeedCommentThread, type FeedDraftSuggestion } from '@/lib/feed-collaboration';
import { Skeleton } from '@/components/skeleton';
import { TuningChatPanel } from './tuning-chat-panel';
export type FeedCommentComposer = { kind: 'comment' | 'suggest'; anchor: FeedAnchor; parentId?: string; threadId?: string };
export type FeedCommentPanelProps = {
  workspaceId: string; assistantId: string; assistantName: string; sessionId: string;
  composition: FeedComposition; revision: number; snapshot?: FeedCollaborationSnapshot | null;
  loading?: boolean; error?: unknown; pending: boolean; offline: boolean; readOnly: boolean;
  composer: FeedCommentComposer | null; onComposer: (value: FeedCommentComposer | null) => void;
  selectedThread: string | null; onThread: (id: string) => void; selection?: FeedTarget;
  onCommand: (commands: FeedCommand[], optimisticEdits?: FeedEdit[]) => Promise<boolean>;
  onRefresh: () => void;
};
const control = 'min-h-11 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50';
export function DraftCommentPanel(props: FeedCommentPanelProps) {
  const t = useT().feedCollaboration;
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [brianThreads, setBrianThreads] = useState<string[]>([]);
  const threads = props.snapshot?.threads ?? [];
  const active = threads.find(thread => thread.id === props.selectedThread);
  const canWrite = !props.readOnly && !props.pending;
  useEffect(() => { if (active?.resolved) setFilter('all'); }, [active?.id, active?.resolved]);
  const visible = threads.filter(thread => filter === 'all' || thread.resolved === (filter === 'resolved'));
  return <section aria-label={t.review} className="h-full overflow-y-auto overscroll-contain p-4 space-y-4" data-feed-review-panel>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t.review}>
      {(['open', 'resolved', 'all'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} className={control} onClick={() => setFilter(value)}>{t[value]}</button>)}
      <button className={control} disabled={!canWrite} onClick={() => props.onComposer({ kind: 'comment', anchor: { target: { kind: 'post' }, quote: '', sourceRevision: props.revision, state: 'attached' } })}>{t.comment}</button>
    </div>
    {props.pending ? <p role="status" className="text-sm text-muted-foreground">{t.pending}</p> : null}
    {props.error ? <div role="alert" className="text-sm"><p>{t.loadFailed}</p><button className={control} onClick={props.onRefresh}>{t.retry}</button></div> : null}
    {props.loading && !props.snapshot ? <Skeleton className="h-36 w-full" /> : null}
    {props.composer ? <CommentComposer key={`${props.composer.parentId ?? ''}:${props.composer.kind}`} {...props} composer={props.composer} /> : null}
    {!visible.length && props.snapshot ? <p className="text-sm text-muted-foreground">{t.noComments}</p> : null}
    {visible.map(thread => <article key={thread.id} data-feed-comment-id={thread.id} className={`rounded-lg border p-3 space-y-3 ${active?.id === thread.id ? 'border-ring' : 'border-border'}`}>
      <button type="button" className="w-full min-h-11 text-left text-sm" onClick={() => props.onThread(thread.id)}>
        <span className="font-medium">{thread.authorKind === 'assistant' ? t.brian : (thread.authorName ?? `${t.author} ${thread.authorUserId.slice(0, 8)}`)}</span>
        <blockquote className="mt-2 line-clamp-3 whitespace-pre-wrap border-l-2 pl-2">{thread.anchor.quote || t.post}</blockquote>
      </button>
      {thread.anchor.state !== 'attached' ? <p className="text-sm text-amber-700 dark:text-amber-400">{thread.anchor.state === 'detached' ? t.detached : t.stale}</p> : null}
      {active?.id === thread.id ? <>
        <ThreadMessages {...props} thread={thread} />
        <div className="flex flex-wrap gap-2">
          <button className={control} disabled={!canWrite} onClick={() => void props.onCommand([{ kind: 'resolve', threadId: thread.id, resolved: !thread.resolved }])}>{thread.resolved ? t.reopen : t.resolve}</button>
          {thread.anchor.state !== 'attached' ? <button className={control} disabled={!canWrite || !props.selection || props.selection.kind === 'post'} onClick={() => props.selection && void props.onCommand([{ kind: 'reattach', threadId: thread.id, target: props.selection }])}>{t.reattach}</button> : null}
          <button className={control} disabled={!canWrite || props.offline} onClick={() => setBrianThreads(current => current.includes(thread.id) ? current : [...current, thread.id])}>{t.askBrian}</button>
          <button className={control} disabled={!canWrite || thread.anchor.state !== 'attached'} onClick={() => props.onComposer({ kind: 'suggest', anchor: thread.anchor, threadId: thread.id })}>{t.suggest}</button>
        </div>
      </> : null}
    </article>)}
    <h3 className="text-sm font-semibold">{t.suggestions}</h3>
    {(props.snapshot?.suggestions ?? []).map(suggestion => <Suggestion key={suggestion.id} {...props} suggestion={suggestion} />)}
    {props.snapshot && !props.snapshot.suggestions.length ? <p className="text-sm text-muted-foreground">{t.noSuggestions}</p> : null}
    {/* A thread's active stream stays mounted when another thread is selected. */}
    {brianThreads.map(threadId => { const thread = threads.find(item => item.id === threadId); return thread ? <div key={threadId} hidden={active?.id !== threadId} className="h-[min(32rem,70dvh)]" data-feed-thread-chat>
      <TuningChatPanel docked assistantId={props.assistantId} assistantName={props.assistantName} workspaceId={props.workspaceId} sessionId={thread.transcriptSessionId} ready={canWrite && !props.offline}
        feedTarget={{ sessionId: props.sessionId, revision: props.revision, threadId }} title={t.askBrian} onTurnComplete={props.onRefresh} />
    </div> : null; })}
  </section>;
}
function CommentComposer(props: FeedCommentPanelProps & { composer: FeedCommentComposer }) {
  const t = useT().feedCollaboration; const [text, setText] = useState(''); const [reason, setReason] = useState(''); const [error, setError] = useState(false);
  const { composer } = props; const blocked = props.readOnly || props.pending || composer.anchor.sourceRevision !== props.revision;
  async function submit() {
    setError(false);
    try {
      const identity = crypto.randomUUID();
      const commands: FeedCommand[] = composer.kind === 'comment' ? [{ kind: 'comment', threadId: identity, target: composer.anchor.target, text }] : [{ kind: 'propose', suggestionId: identity, edits: proposeFeedReplacement(props.composition, composer.anchor.target, text), rationale: reason, parentId: composer.parentId, threadId: composer.threadId }];
      if (await props.onCommand(commands)) { props.onComposer(null); if (composer.kind === 'comment') props.onThread(identity); } else setError(true);
    } catch { setError(true); }
  }
  return <form className="space-y-3 rounded-lg border border-ring p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <p className="text-sm font-medium">{composer.kind === 'comment' ? t.comment : t.suggest}</p>
    <blockquote className="max-h-32 overflow-y-auto whitespace-pre-wrap border-l-2 pl-2 text-sm" aria-label={t.selection}>{composer.anchor.quote || t.post}</blockquote>
    <textarea autoFocus className="w-full min-h-28 rounded-md border bg-background p-2 text-base" aria-label={composer.kind === 'comment' ? t.commentPlaceholder : t.replacementPlaceholder} placeholder={composer.kind === 'comment' ? t.commentPlaceholder : t.replacementPlaceholder} value={text} onChange={event => setText(event.target.value)} />
    {composer.kind === 'suggest' ? <textarea className="w-full min-h-20 rounded-md border bg-background p-2 text-base" aria-label={t.reasonPlaceholder} placeholder={t.reasonPlaceholder} value={reason} onChange={event => setReason(event.target.value)} /> : null}
    {blocked ? <p role="status" className="text-sm">{t.syncFirst}</p> : null}
    {error ? <p role="alert" className="text-sm">{t.loadFailed}</p> : null}
    <div className="flex gap-2"><button type="submit" className={control} disabled={blocked || (composer.kind === 'comment' && !text.trim())}>{t.send}</button><button type="button" className={control} onClick={() => props.onComposer(null)}>{t.cancel}</button></div>
  </form>;
}
type ThreadMessage = { id: string; role: string; content: Array<{ type: string; text?: string }>; senderUserId?: string; senderName?: string; sequence: number };
function ThreadMessages(props: FeedCommentPanelProps & { thread: FeedCommentThread }) {
  const t = useT().feedCollaboration; const [reply, setReply] = useState(''); const [older, setOlder] = useState<ThreadMessage[]>([]);
  const path = feedCollaborationPath(props.assistantId, props.sessionId) + `/threads/${props.thread.id}/messages`;
  const key = feedCollaborationCacheKey(props.workspaceId, props.assistantId, props.sessionId, props.thread.id);
  const resource = useCachedResource<{ messages: ThreadMessage[] }>(key, () => feedPaintFirst(key, () => readFeedCachedJson(path), () => feedCachedJson(path)));
  useEffect(() => { void resource.refresh(); }, [props.snapshot?.copy?.sequence, resource.refresh]);
  const messages = [...new Map([...older, ...(resource.data?.messages ?? [])].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);
  return <div className="space-y-3">
    {resource.loading && !resource.data ? <Skeleton className="h-24 w-full" /> : null}
    {resource.error ? <p role="alert" className="text-sm">{t.loadFailed}<button className={control} onClick={() => void resource.refresh()}>{t.retry}</button></p> : null}
    {messages.length >= 50 && messages[0]!.sequence > 1 ? <button className={control} onClick={() => void feedCachedJson<{ messages: ThreadMessage[] }>(`${path}?before=${messages[0]!.sequence}`).then(result => setOlder(current => [...result.messages, ...current]))}>{t.earlier}</button> : null}
    {messages.map(message => <div key={message.id} className="text-sm"><p className="font-medium">{message.role === 'assistant' ? t.brian : message.senderName ?? `${t.author} ${message.senderUserId?.slice(0, 8) ?? ''}`}</p><p className="whitespace-pre-wrap break-words">{message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')}</p></div>)}
    <form onSubmit={event => { event.preventDefault(); void props.onCommand([{ kind: 'reply', threadId: props.thread.id, text: reply }]).then(ok => { if (ok) setReply(''); }); }} className="space-y-2">
      <textarea className="w-full min-h-20 rounded-md border bg-background p-2 text-base" aria-label={t.reply} value={reply} onChange={event => setReply(event.target.value)} />
      <button className={control} disabled={props.readOnly || props.pending || !reply.trim()}>{t.reply}</button>
    </form>
  </div>;
}
function Suggestion(props: FeedCommentPanelProps & { suggestion: FeedDraftSuggestion }) {
  const t = useT().feedCollaboration; const suggestion = props.suggestion;
  const before = suggestion.edits.map(edit => edit.kind === 'replaceText' ? edit.preimage.map(inlineText).join('\n') : edit.kind === 'replaceBlock' ? feedText(edit.preimage) : '').filter(Boolean).join('\n\n');
  const after = suggestion.edits.map(edit => edit.kind === 'replaceText' ? edit.replacement.map(inlineText).join('\n') : edit.kind === 'replaceBlock' ? edit.replacement.map(feedText).join('\n') : edit.kind === 'insertBlock' ? feedText(edit.node) : '').filter(Boolean).join('\n\n');
  const target: FeedTarget = suggestion.edits[0]?.kind === 'replaceText' ? { kind: 'range', spans: suggestion.edits[0].spans } : suggestion.edits[0] && 'blockId' in suggestion.edits[0] ? { kind: 'block', segmentId: suggestion.edits[0].segmentId, blockId: suggestion.edits[0].blockId } : { kind: 'post' };
  const blocked = props.readOnly || props.pending; const proposed = ['proposed', 'deferred'].includes(suggestion.status);
  return <article className="space-y-3 rounded-lg border p-3" data-feed-suggestion={suggestion.id}>
    <p className="text-sm font-medium">{suggestion.authorKind === 'assistant' ? t.brian : t.author}</p>
    <div className="text-sm"><p className="font-medium">{t.before}</p><p className="whitespace-pre-wrap break-words">{before}</p></div>
    <div className="text-sm"><p className="font-medium">{t.after}</p><p className="whitespace-pre-wrap break-words">{after}</p></div>
    {suggestion.sourceProposal?.imageBrief ? <div className="text-sm"><p className="font-medium">{t.imageBrief}</p><p className="whitespace-pre-wrap">{suggestion.sourceProposal.imageBrief}</p></div> : null}
    {suggestion.rationale ? <p className="text-sm whitespace-pre-wrap">{suggestion.rationale}</p> : null}
    <div className="flex flex-wrap gap-2">
      {proposed ? <><button className={control} disabled={blocked} onClick={() => void props.onCommand([{ kind: 'decide', suggestionId: suggestion.id, outcome: 'accepted', reasonThreadId: suggestion.threadId ?? undefined }], suggestion.edits)}>{t.accept}</button>
        <button className={control} disabled={blocked} onClick={() => void props.onCommand([{ kind: 'decide', suggestionId: suggestion.id, outcome: 'rejected', reasonThreadId: suggestion.threadId ?? undefined }])}>{t.reject}</button>
        <button className={control} disabled={blocked} onClick={() => props.onComposer({ kind: 'suggest', anchor: { target, quote: before, sourceRevision: props.revision, state: 'attached' }, parentId: suggestion.id, threadId: suggestion.threadId ?? undefined })}>{t.refine}</button></> : <p className="text-sm">{suggestion.status === 'accepted' ? t.accepted : suggestion.status === 'rejected' ? t.rejected : t.undone}</p>}
      {suggestion.status === 'accepted' && suggestion.acceptanceReceipt ? <button className={control} disabled={blocked} onClick={() => void props.onCommand([{ kind: 'undo', revision: suggestion.acceptanceReceipt!.revision }])}>{t.undo}</button> : null}
    </div>
  </article>;
}
