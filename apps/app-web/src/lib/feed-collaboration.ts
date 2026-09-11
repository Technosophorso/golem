"use client";
/** Shared cached Feed collaboration client. [COMP:app-web/feed-composition-editor] */
import { useEffect } from 'react';
import type { FeedAnchor, FeedEdit, FeedEditorialRunSummary, FeedReviewFinding } from '@use-brian/shared';
import { useCachedResource, invalidateSurfaceCache } from '@/lib/surface-cache';
import { feedCollaborationCacheKey } from '@/lib/surface-prefetch';
import { feedCachedJson, feedPaintFirst, readFeedCachedJson, isAuthoritativeFeedDenial } from '@/lib/offline/feed-cache';
import { FEED_LOCAL_CHANGED, adoptFeedServerCopy, readLocalFeedPost, type FeedWorkingContent } from '@/lib/offline/feed-offline';
export type FeedCommentThread = { id: string; transcriptSessionId: string; anchor: FeedAnchor; resolved: boolean; authorUserId: string; authorName?: string | null; authorKind: 'user' | 'assistant'; createdAt: string };
export type FeedDraftSuggestion = { id: string; sourceProposal?: { index: number; text: string; label?: string; imageBrief?: string } | null; edits: FeedEdit[]; rationale: string; status: string; threadId: string | null; parentId: string | null; sourceRevision: number; authorUserId: string; authorName?: string | null; authorKind: 'user' | 'assistant'; acceptanceReceipt?: { revision: number } | null };
export type FeedCollaborationSnapshot = { runs?: FeedEditorialRunSummary[]; reviewFindings?: { threadId: string; runId: string; finding: FeedReviewFinding & { sources?: { id: string; title: string; date?: string; link?: string; hash?: string }[] } }[]; copy: { revision: number; mutationId: string; sequence: number; content: FeedWorkingContent } | null; threads: FeedCommentThread[]; suggestions: FeedDraftSuggestion[] };
export const feedCollaborationPath = (assistantId: string, sessionId: string) => `/api/distribution/${assistantId}/draft-sessions/${sessionId}`;
export function useFeedCollaboration(workspaceId: string, assistantId: string, sessionId: string, enabled: boolean) {
  const key = feedCollaborationCacheKey(workspaceId, assistantId, sessionId); const path = feedCollaborationPath(assistantId, sessionId) + '/collaboration';
  const resource = useCachedResource<FeedCollaborationSnapshot>(enabled ? key : null, () => feedPaintFirst(key,
    () => readFeedCachedJson<FeedCollaborationSnapshot>(path),
    async () => { try { return await feedCachedJson<FeedCollaborationSnapshot>(path); } catch (error) { if (isAuthoritativeFeedDenial(error)) invalidateSurfaceCache(key); throw error; } },
  ));
  useEffect(() => {
    if (resource.data?.copy) void adoptFeedServerCopy(assistantId, sessionId, resource.data.copy);
  }, [assistantId, sessionId, resource.data]);
  useEffect(() => {
    const refresh = () => { void readLocalFeedPost(assistantId, sessionId).then(post => { if (enabled && post && !post.dirty) void resource.refresh(); }); };
    window.addEventListener(FEED_LOCAL_CHANGED, refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener(FEED_LOCAL_CHANGED, refresh); window.removeEventListener('online', refresh); };
  }, [assistantId, sessionId, enabled, resource.refresh]);
  return resource;
}
