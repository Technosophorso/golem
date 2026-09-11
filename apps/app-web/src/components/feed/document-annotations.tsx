"use client";

/** Stable, measured comment markers beside document blocks. [COMP:app-web/feed-document-annotations] */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';
import { format } from '@/lib/i18n/format';
import type { FeedCommentThread } from '@/lib/feed-collaboration';

type Marker = { id: string; ids: string[]; top: number };
export function FeedDocumentAnnotations({ documentRef, threads, onThread }: {
  documentRef: RefObject<HTMLDivElement | null>;
  threads: FeedCommentThread[];
  onThread: (id: string) => void;
}) {
  const t = useT().feedCollaboration;
  const [markers, setMarkers] = useState<Marker[]>([]);
  useLayoutEffect(() => {
    const doc = documentRef.current; if (!doc) return;
    const measure = () => {
      const groups = new Map<string, string[]>();
      for (const thread of threads) {
        if (thread.resolved || thread.anchor.state === 'detached') continue;
        const target = thread.anchor.target;
        const block = target.kind === 'block' ? target.blockId : target.kind === 'range' ? target.spans[0]?.blockId : undefined;
        if (block) groups.set(block, [...(groups.get(block) ?? []), thread.id]);
      }
      const elements = [...doc.querySelectorAll<HTMLElement>('[data-block-id]')];
      const origin = doc.getBoundingClientRect().top;
      const next: Marker[] = [];
      for (const [id, ids] of groups) {
        const element = elements.find(item => item.dataset.blockId === id);
        if (element) next.push({ id, ids, top: Math.max(0, element.getBoundingClientRect().top - origin) });
      }
      next.sort((a, b) => a.top - b.top);
      // Multiple nearby/nested targets must keep separate touch targets.
      for (let i = 1; i < next.length; i++) next[i]!.top = Math.max(next[i]!.top, next[i - 1]!.top + 44);
      setMarkers(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(doc);
    const mutation = new MutationObserver(measure);
    mutation.observe(doc, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-block-id'] });
    window.addEventListener('resize', measure);
    return () => { resize?.disconnect(); mutation.disconnect(); window.removeEventListener('resize', measure); };
  }, [documentRef, threads]);
  return <div className="pointer-events-none absolute inset-0" data-feed-annotations>
    {markers.map(marker => <Button key={marker.id} type="button" variant="secondary" size="icon"
      className="pointer-events-auto absolute right-0 size-11 md:h-8 md:w-10 gap-0.5 rounded-lg border border-border bg-background text-muted-foreground shadow-xs hover:text-foreground"
      style={{ top: marker.top }} aria-label={format(t.openComments, { n: String(marker.ids.length) })}
      data-feed-comment-marker={marker.ids[0]} onMouseDown={event => event.preventDefault()} onClick={() => onThread(marker.ids[0]!)}>
      <MessageSquareText className="size-3.5" aria-hidden /><span className="text-[10px]">{marker.ids.length}</span>
    </Button>)}
  </div>;
}
