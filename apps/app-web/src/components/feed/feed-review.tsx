"use client";
/** Five-check Review and its coverage live in the ordinary comment panel. [COMP:app-web/feed-review] */
import { useRef, useState } from 'react';
import { FEED_REVIEW_DIMENSIONS, type FeedCommand, type FeedReviewRequest } from '@use-brian/shared';
import { useLocale, useT } from '@/lib/i18n/client';
import { authFetch } from '@/lib/auth-fetch';
import { publicRuntimeConfig } from '@/lib/runtime-public-config';
import { feedCollaborationPath, type FeedCollaborationSnapshot } from '@/lib/feed-collaboration';
import { useCachedResource } from '@/lib/surface-cache';
import { goalsCacheKey } from '@/lib/surface-prefetch';
import { feedCachedJson, feedPaintFirst, readFeedCachedJson } from '@/lib/offline/feed-cache';
import type { GoalRow } from '@/lib/api/goals';
import { SearchableSelect } from '@/components/ui/searchable-select';
const control = 'min-h-11 rounded-md border px-3 text-sm disabled:opacity-50';
export function useFeedReviewActions(assistantId: string, sessionId: string, revision: number, onRefresh: () => void) {
  const locale = useLocale(); const [model, setModel] = useState<FeedReviewRequest['model']>('standard'); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const retained = useRef<{ key: string; mutationId: string } | null>(null);
  async function request(suffix: string, body: unknown) {
    if (busy) return; setBusy(true); setError(false);
    try {
      const response = await authFetch(`${publicRuntimeConfig().apiUrl ?? 'http://localhost:4000'}${feedCollaborationPath(assistantId, sessionId)}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('Review request failed');
      retained.current = null; onRefresh();
    } catch { setError(true); onRefresh(); } finally { setBusy(false); }
  }
  async function start(continuationRunId?: string) {
    const key = JSON.stringify({ assistantId, sessionId, revision, model, locale, continuationRunId });
    if (retained.current?.key !== key) retained.current = { key, mutationId: crypto.randomUUID() };
    await request('/reviews', { mutationId: retained.current.mutationId, expectedRevision: revision, model, locale, continuationRunId });
  }
  return { model, setModel, busy, error, start, action: (id: string, action: 'retry' | 'cancel') => request(`/runs/${id}/${action}`, {}) };
}
export type FeedReviewActions = ReturnType<typeof useFeedReviewActions>;
export function FeedReview(props: {
  workspaceId: string; revision: number; snapshot?: FeedCollaborationSnapshot | null; disabled: boolean; offline: boolean;
  goalId?: string | null; month?: string; actions: FeedReviewActions; onCommand: (commands: FeedCommand[]) => Promise<boolean>; onThread: (id: string) => void;
}) {
  const t = useT().feedReview; const tc = useT().feedCollaboration;
  const goalsPath = `/api/goals?workspaceId=${encodeURIComponent(props.workspaceId)}&includeTerminal=true`;
  const key = goalsCacheKey(props.workspaceId, 'all');
  const goals = useCachedResource<GoalRow[]>(key, () => feedPaintFirst(key, async () => (await readFeedCachedJson<{ goals: GoalRow[] }>(goalsPath))?.goals ?? null, async () => (await feedCachedJson<{ goals: GoalRow[] }>(goalsPath)).goals));
  const runs = props.snapshot?.runs?.filter(run => run.kind === 'review') ?? []; const active = runs.some(run => run.status === 'pending' || run.status === 'running');
  const disabled = props.disabled || props.actions.busy; const remoteDisabled = disabled || props.offline;
  return <section className="space-y-3 rounded-lg border p-3" aria-label={t.checks}>
    <h3 className="text-sm font-semibold">{t.checks}</h3>
    <p className="text-sm text-muted-foreground">{t.explanation}</p>
    <label className="block text-sm space-y-1"><span>{t.month}</span><input type="month" aria-label={t.month} className="min-h-11 w-full rounded-md border bg-background px-2 text-base" value={props.month ?? ''} disabled={disabled} onChange={event => { if (event.target.value) void props.onCommand([{ kind: 'context', reviewMonth: event.target.value }]); }} /></label>
    {!props.month ? <p className="text-xs text-muted-foreground">{t.automaticMonth}</p> : null}
    <label className="block text-sm space-y-1"><span>{t.goal}</span><SearchableSelect value={props.goalId ?? ''} disabled={disabled || goals.loading || Boolean(goals.error)} onValueChange={value => void props.onCommand([{ kind: 'context', goalId: value || null }])} items={[{ value: '', label: t.noGoal }, ...(Array.isArray(goals.data) ? goals.data : []).map(goal => ({ value: goal.id, label: goal.outcome }))]} placeholder={props.goalId ? t.goal : t.noGoal} emptyMessage={t.noGoal} /></label>
    {goals.error ? <p role="alert" className="text-sm">{t.goalUnavailable}<button className={control} onClick={() => void goals.refresh()}>{tc.retry}</button></p> : null}
    <div role="group" aria-label={t.model} className="flex flex-wrap gap-2">{(['standard', 'pro', 'max'] as const).map(model => <button key={model} className={control} disabled={remoteDisabled || active} aria-pressed={props.actions.model === model} onClick={() => props.actions.setModel(model)}>{t[model]}</button>)}</div>
    <button className={control} disabled={remoteDisabled || active} onClick={() => void props.actions.start()}>{tc.review}</button>
    {props.offline ? <p role="status" className="text-sm">{t.offline}</p> : props.disabled ? <p role="status" className="text-sm">{tc.syncFirst}</p> : null}
    {props.actions.error ? <p role="alert" className="text-sm">{t.requestFailed}</p> : null}
    {!runs.length ? <p className="text-sm text-muted-foreground">{t.notReviewed}</p> : null}
    {runs.map(run => <article key={run.id} className="space-y-2 border-t pt-3" data-feed-review-run={run.id}>
      <p className="text-sm font-medium">{t[run.status]}{run.stale || run.revision !== props.revision ? ` · ${t.stale}` : ''}</p>
      {run.month ? <p className="text-xs text-muted-foreground">{t.month}: {run.month}{run.goalTitle ? ` · ${run.goalTitle}` : ''}</p> : null}
      {run.status === 'unknown_outcome' || run.error === 'cancelled_after_dispatch' ? <p role="status" className="text-sm">{t.unknownExplanation}</p> : null}
      <ul className="space-y-1 text-sm">{FEED_REVIEW_DIMENSIONS.map(dimension => { const coverage = run.coverage[dimension]; return <li key={dimension}>
        <span className="font-medium">{t[dimension]}</span>: {coverage ? `${t[coverage.state]} (${coverage.reviewed}/${coverage.eligible})` : t.pending}
        {coverage?.oldest ? <span className="block text-xs text-muted-foreground">{coverage.oldest.slice(0, 10)} - {coverage.newest?.slice(0, 10)}</span> : null}
        {coverage?.limits.length ? <span className="block text-xs text-muted-foreground">{t.coverageLimited}</span> : null}
      </li>; })}</ul>
      <div className="flex flex-wrap gap-2">
        {run.summaryThreadId ? <button className={control} onClick={() => props.onThread(run.summaryThreadId!)}>{t.openSummary}</button> : null}
        {run.status === 'pending' || run.status === 'running' ? <button className={control} disabled={remoteDisabled} onClick={() => void props.actions.action(run.id, 'cancel')}>{tc.cancel}</button> : null}
        {(run.status === 'failed' || run.status === 'cancelled') && run.attempts < 3 && run.error !== 'cancelled_after_dispatch' ? <button className={control} disabled={remoteDisabled} onClick={() => void props.actions.action(run.id, 'retry')}>{tc.retry}</button> : null}
        {run.status === 'succeeded' && run.coverage.post_history?.nextCursor != null ? <button className={control} disabled={remoteDisabled || active || run.stale || run.revision !== props.revision} onClick={() => void props.actions.start(run.id)}>{t.continueHistory}</button> : null}
      </div>
    </article>)}
  </section>;
}
