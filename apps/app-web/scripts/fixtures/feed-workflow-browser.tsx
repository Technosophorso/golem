import { useState } from 'react';
import { FeedPostWorkflow } from '@/components/feed/post-workflow';
import { FeedEditorPanel } from '@/components/feed/editor-panel';
import { FeedReview, type FeedReviewActions } from '@/components/feed/feed-review';
import { useT } from '@/lib/i18n/client';
import type { PostQueueStatus } from '@/lib/feed-posts';

export function FeedWorkflowFixture() {
  const t = useT();
  const [status, setStatus] = useState<PostQueueStatus>('drafting');
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [model, setModel] = useState<FeedReviewActions['model']>('standard');
  const actions: FeedReviewActions = { model, setModel, busy: false, error: false, start: async () => {}, action: async () => {} };
  return <main className="h-dvh overflow-y-auto bg-background" data-workflow-scroll>
    <div className="mx-auto max-w-5xl p-3 sm:p-5">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background py-3" data-feed-document-header>
        <h1 className="w-full text-base font-semibold">An orchard through the seasons</h1>
        <FeedPostWorkflow status={status} hasEdits={false} actionDisabled={false} reviewOpen={open}
          onReview={node => { setAnchor(node); setOpen(true); }} onCommit={() => setStatus('review')}
          onApprove={() => setStatus('ready')} onPosted={() => setStatus('posted')} />
      </header>
      <article className="space-y-6 py-6 text-base leading-relaxed">
        {Array.from({ length: 24 }, (_, i) => <p key={i}>Paragraph {i + 1}. A fictional orchard grows apples and pears. Each season brings new work, from pruning branches to gathering the harvest.</p>)}
      </article>
      <FeedEditorPanel open={open} title={t.feedCollaboration.review} anchor={anchor} onClose={() => setOpen(false)}>
        <FeedReview workspaceId="fictional-workspace" revision={1} disabled={false} offline={false} actions={actions} onCommand={async () => true} onThread={() => {}} />
      </FeedEditorPanel>
    </div>
  </main>;
}
