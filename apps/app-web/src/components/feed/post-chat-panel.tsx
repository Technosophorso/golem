"use client";

/** The post and its thread transcripts share one chat rail. [COMP:app-web/feed-post-chat] */
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import type { FeedCommentThread } from '@/lib/feed-collaboration';
import type { DockRecorderApi } from '@/lib/recorder/use-dock-recorder';
import { TuningChatPanel } from './tuning-chat-panel';

export function FeedPostChat(props: {
  workspaceId: string;
  assistantId: string;
  assistantName: string;
  sessionId: string;
  revision: number;
  ready: boolean;
  threads: FeedCommentThread[];
  openedThreadIds: string[];
  activeThreadId: string | null;
  selectionQuote?: string;
  mainChat: ReactNode;
  dockRecorder?: DockRecorderApi;
  onWholePost: () => void;
  onRefresh: () => void;
}) {
  const t = useT().feedCollaboration;
  const te = useT().feedPage.postEditor;
  const active = props.threads.find(thread => thread.id === props.activeThreadId);
  const quote = active ? active.anchor.quote || t.post : props.selectionQuote;
  return <div className="flex h-full min-h-0 flex-col" data-feed-chat-panel>
    {quote ? <div className="shrink-0 border-b bg-muted/20 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{active ? t.commentConversation : t.selection}</span>
        <Button type="button" variant="secondary" size="sm" className="min-h-11 md:min-h-8 shrink-0" onClick={props.onWholePost}><ArrowLeft aria-hidden />{t.post}</Button>
      </div>
      <blockquote className="h-20 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words border-l-2 pl-2 text-muted-foreground">{quote}</blockquote>
    </div> : null}
    {/* Hiding a context must not discard its draft input or active stream. */}
    <div hidden={Boolean(active)} inert={Boolean(active)} className="relative min-h-0 flex-1" data-feed-post-conversation>{props.mainChat}</div>
    {props.openedThreadIds.map(id => {
      const thread = props.threads.find(item => item.id === id);
      return thread ? <div key={id} hidden={active?.id !== id} inert={active?.id !== id} className="relative min-h-0 flex-1" data-feed-thread-chat={id}>
        <TuningChatPanel docked assistantId={props.assistantId} assistantName={props.assistantName}
          workspaceId={props.workspaceId} sessionId={thread.transcriptSessionId} ready={props.ready}
          feedTarget={{ sessionId: props.sessionId, revision: props.revision, threadId: id }}
          dockRecorder={props.dockRecorder} ownsDockRecorderTarget={active?.id === id}
          title={t.askBrian} headline={t.commentConversation} composerPlaceholder={te.chatPlaceholder}
          emptyTitle={te.chatEmptyTitle} emptyBody={te.chatEmptyBody} onTurnComplete={props.onRefresh} />
      </div> : null;
    })}
  </div>;
}
