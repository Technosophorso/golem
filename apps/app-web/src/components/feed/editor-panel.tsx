"use client";

/** Retained on-demand comments and details. [COMP:app-web/feed-editor-panel] */
import { useRef, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import { useLgViewport } from './use-lg-viewport';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';

export function FeedEditorPanel({ open, title, anchor, passage = false, onClose, children }: {
  open: boolean; title: string; anchor: HTMLElement | null; passage?: boolean;
  onClose: () => void; children: ReactNode;
}) {
  const t = useT().feedCollaboration;
  const isLg = useLgViewport();
  const heading = useRef<HTMLHeadingElement>(null);
  return <Popover.Root open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <Popover.Portal keepMounted>
      <Popover.Positioner anchor={anchor} side={passage && isLg ? 'left' : 'bottom'} align="start" sideOffset={8} className="z-40">
        <Popover.Popup initialFocus={heading} finalFocus={() => anchor?.isConnected ? anchor : false}
          aria-label={title} hidden={!open} inert={!open}
          className="flex w-96 max-w-[calc(100vw-1.5rem)] max-h-[min(76dvh,var(--available-height))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl outline-none" data-feed-editor-panel>
          <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
            <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">{title}</h2>
            <Popover.Close render={<Button type="button" variant="ghost" size="icon" className="size-11 md:size-8" aria-label={t.closePanel} />}><X className="size-4" aria-hidden /></Popover.Close>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-4">{children}</div>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
