"use client";
/** Exact selected memories for this shared draft. [COMP:app-web/feed-sources] */
import { useState } from 'react';
import type { FeedCommand } from '@use-brian/shared';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useT } from '@/lib/i18n/client';
import { useCachedResource } from '@/lib/surface-cache';
import { authFetch } from '@/lib/auth-fetch';
import { publicRuntimeConfig } from '@/lib/runtime-public-config';
import { feedCollaborationPath } from '@/lib/feed-collaboration';
import { feedSourcesCacheKey } from '@/lib/surface-prefetch';
export function FeedSources(props: { workspaceId: string; assistantId: string; sessionId: string; selected: string[]; disabled: boolean; onCommand: (commands: FeedCommand[]) => Promise<boolean> }) {
  const t = useT().feedPage.postEditor;
  const [open, setOpen] = useState(false);
  const path = feedCollaborationPath(props.assistantId, props.sessionId) + '/sources?kind=memory';
  const resource = useCachedResource<{ sources: { id: string; name: string; sensitivity: string }[] }>(open ? feedSourcesCacheKey(props.workspaceId, props.assistantId, props.sessionId, 'memory') : null, async () => {
    const response = await authFetch(`${publicRuntimeConfig().apiUrl ?? ''}${path}`);
    if (!response.ok) throw new Error('source_access_required');
    return response.json();
  });
  const sources = resource.error ? [] : resource.data?.sources ?? [];
  return <section className="space-y-2">
    <Button variant="outline" disabled={props.disabled} aria-expanded={open} onClick={() => setOpen(!open)}>{t.selectedSources}</Button>
    {open ? <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">{t.selectedSourcesHint}</p>
      {resource.error ? <p role="alert">{t.sourceAccessBlocked}</p> : null}
      <SearchableSelect value="" items={sources.filter(source => !props.selected.includes(source.id)).map(source => ({ value: source.id, label: source.name }))} placeholder={t.addSource} disabled={props.disabled || resource.loading || props.selected.length >= 100} onValueChange={id => { void props.onCommand([{ kind: 'context', selectedMemoryIds: [...props.selected, id] }]); }} />
      {props.selected.map((id, index) => <div key={id} className="flex items-center justify-between gap-2 text-sm"><span>{sources.find(source => source.id === id)?.name ?? `${t.selectedSources} ${index + 1}`}</span><Button variant="ghost" disabled={props.disabled} onClick={() => { void props.onCommand([{ kind: 'context', selectedMemoryIds: props.selected.filter(value => value !== id) }]); }}>{t.removeSource}</Button></div>)}
    </div> : null}
  </section>;
}
