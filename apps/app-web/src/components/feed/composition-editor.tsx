"use client";
/** Feed ProseMirror authoring with stable target decorations. [COMP:app-web/feed-composition-editor] */
import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, PencilLine, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeedEditorToolbar, type FeedFormatAction, type FeedPlaceholderAction, type FeedBlockAction } from './editor-toolbar';
import { createPortal } from 'react-dom';
import { GenerationPlaceholder, FeedDetachedGenerationResults, FeedGenerationImage, type FeedGenerationControls } from './generation-placeholder';
import { EditorState, NodeSelection, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { EditorView, Decoration, DecorationSet } from '@tiptap/pm/view';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from '@tiptap/pm/commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { promptDialog } from '@/components/ui/prompt-dialog';
import { keymap } from '@tiptap/pm/keymap';
import { history, undo, redo } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { feedSchema, insertFeedPlaceholder, locateFeedNode, duplicateFeedNode, diffFeedComposition, validateFeedComposition, feedTargetQuote } from '@use-brian/doc-model';
import type { FeedComposition, FeedTarget, FeedEdit, FeedNode, FeedAnchor } from '@use-brian/shared';
import { useT } from '@/lib/i18n/client';
import type { FeedCommentThread } from '@/lib/feed-collaboration';
export type FeedEditorSelection = { target: FeedTarget; quote: string; caret?: { segmentId: string; blockId: string; offset: number } };
const decorationKey = new PluginKey('feed-comments');
function cleanNode(node: PMNode): FeedNode {
  const json = node.toJSON();
  if (node.isTextblock && !json.content) json.content = [];
  const clean = (value: unknown): unknown => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== null && !(key === 'marks' && Array.isArray(v) && !v.length)).map(([key, v]) => [key, clean(v)])) : value;
  return clean(json) as FeedNode;
}
function feedSelectionFromEditor(state: EditorState, segmentId: string, composition: FeedComposition): FeedEditorSelection {
  const spans: Array<{ segmentId: string; blockId: string; from: number; to: number }> = [];
  const { from, to } = state.selection;
  let block: { id: string; pos: number; text: boolean } | null = null;
  state.doc.descendants((node, pos) => {
    if (node.isBlock && node.attrs.id && from >= pos && from <= pos + node.nodeSize) block = { id: node.attrs.id, pos, text: node.isTextblock };
    if (node.isTextblock && node.attrs.id && from < pos + 1 + node.content.size && to > pos + 1) spans.push({ segmentId, blockId: node.attrs.id, from: Math.max(0, from - pos - 1), to: Math.min(node.content.size, to - pos - 1) });
  });
  const found = block as { id: string; pos: number; text: boolean } | null;
  const target: FeedTarget = spans.length && from !== to ? { kind: 'range', spans } : found ? { kind: 'block', segmentId, blockId: found.id } : { kind: 'post' };
  return { target, quote: feedTargetQuote(composition, target), ...(found?.text ? { caret: { segmentId, blockId: found.id, offset: Math.max(0, from - found.pos - 1) } } : {}) };
}
export function CompositionEditor(props: {
  generation?: FeedGenerationControls; composition: FeedComposition; readOnly?: boolean; threads: FeedCommentThread[]; draftAnchor?: FeedAnchor | null;
  onEdit: (edits: FeedEdit[]) => void; onSelection: (selection: FeedEditorSelection) => void;
  onAction: (action: 'comment' | 'suggest' | 'ask') => void; onOpenThread: (threadId: string) => void;
}) {
  const t = useT().feedCollaboration;
  return <div className="space-y-4" data-feed-composition>
    {props.composition.segments.map(segment => <FeedSegmentEditor key={segment.id} {...props} segmentId={segment.id} />)}
    {props.generation ? <FeedDetachedGenerationResults controls={props.generation} /> : null}
    <div role="group" aria-label={t.blockActions} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/25 p-2">
      <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => props.onAction('comment')}><MessageSquarePlus aria-hidden />{t.comment}</Button>
      <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" aria-label={t.suggest} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => props.onAction('suggest')}><PencilLine aria-hidden />{t.suggestShort}</Button>
      <Button type="button" size="sm" className="ml-auto min-h-11 md:min-h-8" disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => props.onAction('ask')}><Sparkles aria-hidden />{t.askBrian}</Button>
    </div>
  </div>;
}
function FeedSegmentEditor(props: Parameters<typeof CompositionEditor>[0] & { segmentId: string }) {
  const t = useT().feedCollaboration; const host = useRef<HTMLDivElement>(null); const viewRef = useRef<EditorView | null>(null); const latest = useRef(props); latest.current = props;
  const [slotMounts, setSlotMounts] = useState<{ id: string; dom: HTMLElement }[]>([]);
  const [formatting, setFormatting] = useState<Partial<Record<FeedFormatAction, boolean>>>({});
  const local = useRef(props.composition); const lastEmitted = useRef('');
  const decorations = (doc: PMNode) => {
    const output: Decoration[] = [];
    const anchors = [...latest.current.threads.filter(thread => !thread.resolved).map(thread => ({ id: thread.id, anchor: thread.anchor })), ...(latest.current.draftAnchor ? [{ id: 'draft', anchor: latest.current.draftAnchor }] : [])];
    doc.descendants((node, pos) => {
      if (!node.attrs.id) return;
      for (const item of anchors) {
        const { target, state } = item.anchor; if (state === 'detached') continue;
        if (target.kind === 'block' && target.segmentId === props.segmentId && target.blockId === node.attrs.id) output.push(Decoration.node(pos, pos + node.nodeSize, { class: 'bg-amber-100/60 dark:bg-amber-900/30', 'data-feed-thread': item.id }));
        if (target.kind === 'range' && node.isTextblock) for (const span of target.spans) if (span.segmentId === props.segmentId && span.blockId === node.attrs.id && span.to > span.from && span.to <= node.content.size) output.push(Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { class: 'bg-amber-200/60 dark:bg-amber-800/50 rounded-sm', 'data-feed-thread': item.id }));
      }
    });
    return DecorationSet.create(doc, output);
  };
  useEffect(() => {
    if (!host.current) return;
    const segment = latest.current.composition.segments.find(s => s.id === props.segmentId)!;
    local.current = latest.current.composition;
    const view = new EditorView(host.current, {
      state: EditorState.create({ schema: feedSchema, doc: feedSchema.nodeFromJSON({ type: 'doc', content: segment.content }), plugins: [history(), keymap({ 'Mod-b': toggleMark(feedSchema.marks.bold!), 'Mod-i': toggleMark(feedSchema.marks.italic!), 'Mod-z': undo, 'Mod-Shift-z': redo, ...baseKeymap, Enter: (state, dispatch, view) => {
          const block = state.selection.$from.parent; const shortcut = /^\/(text|image)$/.exec(block.textContent);
          if (shortcut && state.selection.empty && block.type.name === 'paragraph' && !latest.current.readOnly) {
            const node: FeedNode = { type: 'generationPlaceholder', attrs: { id: block.attrs.id, kind: shortcut[1] as 'text' | 'image', brief: '', briefRevision: 0, references: [] } };
            latest.current.onEdit([{ kind: 'replaceBlock', segmentId: props.segmentId, blockId: block.attrs.id, preimage: cleanNode(block), replacement: [node] }]); return true;
          }
          return splitListItem(feedSchema.nodes.listItem!)(state, dispatch) || baseKeymap.Enter!(state, dispatch, view);
        }, Tab: sinkListItem(feedSchema.nodes.listItem!), 'Shift-Tab': liftListItem(feedSchema.nodes.listItem!) }), new Plugin({ key: decorationKey, props: { decorations: state => decorations(state.doc) } })] }),
      nodeViews: props.generation ? { generationPlaceholder(node) {
        const dom = document.createElement('div'); const slotId = String(node.attrs.id); dom.contentEditable = 'false'; dom.dataset.placeholderId = slotId;
        setSlotMounts(mounts => [...mounts.filter(item => item.id !== slotId), { id: slotId, dom }]);
        return { dom, update(next) { return next.type.name === 'generationPlaceholder' && next.attrs.id === slotId; }, ignoreMutation: () => true, stopEvent: () => true, destroy() { setSlotMounts(mounts => mounts.filter(item => item.dom !== dom)); } };
      }, image(node) {
        const dom = document.createElement('div'); const blockId = String(node.attrs.id); dom.contentEditable = 'false';
        setSlotMounts(mounts => [...mounts.filter(item => item.id !== blockId), { id: blockId, dom }]);
        return { dom, update(next) { return next.type.name === 'image' && next.attrs.id === blockId; }, ignoreMutation: () => true, destroy() { setSlotMounts(mounts => mounts.filter(item => item.dom !== dom)); } };
      } } : undefined,
      editable: () => !latest.current.readOnly,
      attributes: { role: 'textbox', 'aria-label': t.editor, 'aria-multiline': 'true', class: 'min-h-64 bg-card p-5 text-base leading-relaxed outline-none [&_p]:my-3 [&_h1]:text-2xl [&_h2]:text-xl [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-4' },
      handleClick(_view, _pos, event) { const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-feed-thread]'); if (hit?.dataset.feedThread && hit.dataset.feedThread !== 'draft') latest.current.onOpenThread(hit.dataset.feedThread); return false; },
      dispatchTransaction(transaction: Transaction) {
        let next = view.state.apply(transaction);
        if (transaction.docChanged) {
          const seen = new Set<string>(); const identity = next.tr;
          next.doc.descendants((node, pos) => { if (!node.isBlock) return; let blockId = node.attrs.id as string | null; if (!blockId || seen.has(blockId)) { blockId = crypto.randomUUID(); identity.setNodeMarkup(pos, undefined, { ...node.attrs, id: blockId }); } seen.add(blockId); });
          if (identity.docChanged) next = next.apply(identity);
        }
        view.updateState(next);
        const active: Partial<Record<FeedFormatAction, boolean>> = {};
        for (const mark of ['bold', 'italic', 'link'] as const) {
          const type = feedSchema.marks[mark]!;
          active[mark] = next.selection.empty ? Boolean(type.isInSet(next.storedMarks ?? next.selection.$from.marks())) : next.doc.rangeHasMark(next.selection.from, next.selection.to, type);
        }
        for (let depth = next.selection.$from.depth; depth > 0; depth--) {
          const kind = next.selection.$from.node(depth).type.name;
          if (kind === 'heading' || kind === 'bulletList' || kind === 'orderedList' || kind === 'blockquote') active[kind] = true;
        }
        setFormatting(previous => JSON.stringify(previous) === JSON.stringify(active) ? previous : active);
        if (transaction.docChanged) {
          const content: FeedNode[] = []; next.doc.forEach(node => content.push(cleanNode(node)));
          const before = local.current; const composition = validateFeedComposition({ ...before, segments: before.segments.map(s => s.id === props.segmentId ? { ...s, content } : s) });
          const edits = diffFeedComposition(before, composition); local.current = composition; lastEmitted.current = JSON.stringify(composition);
          if (edits.length) latest.current.onEdit(edits);
        }
        latest.current.onSelection(feedSelectionFromEditor(next, props.segmentId, local.current));
      },
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [props.segmentId, t.editor]);
  useEffect(() => {
    const view = viewRef.current; if (!view) return;
    const serialized = JSON.stringify(props.composition);
    if (serialized !== lastEmitted.current && serialized !== JSON.stringify(local.current)) {
      const segment = props.composition.segments.find(s => s.id === props.segmentId); if (!segment) return;
      const doc = feedSchema.nodeFromJSON({ type: 'doc', content: segment.content });
      if (!doc.eq(view.state.doc)) view.updateState(EditorState.create({ schema: feedSchema, doc, plugins: view.state.plugins }));
    }
    local.current = props.composition; view.setProps({ editable: () => !latest.current.readOnly }); view.dispatch(view.state.tr.setMeta(decorationKey, true));
  }, [props.composition, props.threads, props.draftAnchor, props.readOnly, props.segmentId]);
  function format(action: FeedFormatAction) {
    const view = viewRef.current; if (!view) return;
    if (action === 'link') { void (async () => { const view = viewRef.current; if (!view) return; const href = await promptDialog({ title: t.link, placeholder: t.linkPlaceholder, confirmLabel: t.accept, cancelLabel: t.cancel, allowEmpty: true }); if (href === null || (href && !/^https?:\/\//i.test(href))) return; try { if (href) new URL(href); else { view.dispatch(view.state.tr.removeMark(view.state.selection.from, view.state.selection.to, feedSchema.marks.link!)); return; } toggleMark(feedSchema.marks.link!, { href })(view.state, view.dispatch); view.focus(); } catch { /* Invalid URL leaves the selected content unchanged. */ } })(); return; }
    if (action === 'bold' || action === 'italic') toggleMark(feedSchema.marks[action]!)(view.state, view.dispatch);
    else {
      const command = action === 'heading' ? setBlockType(feedSchema.nodes.heading!, { level: 2 }) : action === 'blockquote' ? wrapIn(feedSchema.nodes.blockquote!) : wrapInList(feedSchema.nodes[action]!);
      command(view.state, view.dispatch);
    }
    view.focus();
  }
  function placeholder(action: FeedPlaceholderAction) {
    const view = viewRef.current; if (!view) return;
    const selected = feedSelectionFromEditor(view.state, props.segmentId, local.current); const convert = action.startsWith('convert'); if (convert && selected.target.kind === 'post') return;
    try { latest.current.onEdit(insertFeedPlaceholder(local.current, selected, action.endsWith('Image') ? 'image' : 'text', convert)); } catch { /* Non-text atoms cannot be converted to notes. */ }
  }
  function blockAction(action: FeedBlockAction) {
    const view = viewRef.current; if (!view) return;
    const selected = feedSelectionFromEditor(view.state, props.segmentId, local.current); const blockId = selected.caret?.blockId ?? (selected.target.kind === 'block' ? selected.target.blockId : undefined); if (!blockId) return;
    const { node, siblings, index, parentId } = locateFeedNode(local.current, props.segmentId, blockId);
    if (action === 'duplicate') latest.current.onEdit([{ kind: 'insertBlock', segmentId: props.segmentId, parentId, afterId: blockId, node: duplicateFeedNode(node) }]);
    else if (action === 'deleteBlock') { let position: number | undefined; view.state.doc.descendants((item, pos) => { if (item.attrs.id === blockId) position = pos; }); if (position !== undefined) view.dispatch(view.state.tr.delete(position, position + feedSchema.nodeFromJSON(node).nodeSize)); }
    else if ((action === 'moveUp' && index > 0) || (action === 'moveDown' && index < siblings.length - 1)) latest.current.onEdit([{ kind: 'moveBlock', segmentId: props.segmentId, blockId, parentId, afterId: action === 'moveUp' ? siblings[index - 2]?.attrs.id ?? null : siblings[index + 1]!.attrs.id }]);
  }
  return <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors focus-within:border-ring [&_:focus-visible]:shadow-none" data-feed-segment-editor>
    <FeedEditorToolbar disabled={props.readOnly} active={formatting} onFormat={format} onPlaceholder={placeholder} onBlock={blockAction} focusEditor={() => viewRef.current?.focus()} />
    <div ref={host} />
    {props.generation ? slotMounts.map(mount => {
      let found: ReturnType<typeof locateFeedNode>; try { found = locateFeedNode(props.composition, props.segmentId, mount.id); } catch { return null; }
      if (found.node.type === 'image') return createPortal(<FeedGenerationImage workspaceId={props.generation!.workspaceId} fileId={found.node.attrs.fileId} alt={found.node.attrs.alt ?? ''} />, mount.dom, mount.id);
      if (found.node.type !== 'generationPlaceholder') return null;
      return createPortal(<GenerationPlaceholder slot={found.node.attrs} segmentId={props.segmentId} controls={props.generation!} onEdit={props.onEdit}
        onSelect={() => { const view = viewRef.current; if (!view) return; let position: number | undefined; view.state.doc.descendants((node, pos) => { if (node.attrs.id === mount.id) position = pos; }); if (position !== undefined && (!(view.state.selection instanceof NodeSelection) || view.state.selection.from !== position)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position))); }} onAction={props.onAction} />, mount.dom, mount.id);
    }) : null}

  </div>;
}

/** The accepted outline, including inline images, in document order. */
export function FeedCompositionPreview({ composition, workspaceId }: { composition: FeedComposition; workspaceId: string }) {
  const renderInline = (node: Extract<FeedNode, { type: 'paragraph' | 'heading' }>) => (node.content ?? []).map((part, index) => {
    if (part.type === 'hardBreak') return <br key={index} />;
    let text: import('react').ReactNode = part.text;
    for (const mark of part.marks ?? []) text = mark.type === 'bold' ? <strong>{text}</strong> : mark.type === 'italic' ? <em>{text}</em> : <a href={mark.attrs.href} rel="noopener noreferrer" className="underline">{text}</a>;
    return <span key={index}>{text}</span>;
  });
  const render = (node: FeedNode): import('react').ReactNode => {
    if (node.type === 'generationPlaceholder') return null;
    if (node.type === 'image') return <figure key={node.attrs.id}><FeedGenerationImage workspaceId={workspaceId} fileId={node.attrs.fileId} alt={node.attrs.alt ?? ''} /></figure>;
    if (node.type === 'paragraph') return <p key={node.attrs.id}>{renderInline(node)}</p>;
    if (node.type === 'heading') return <div key={node.attrs.id} role="heading" aria-level={node.attrs.level} className="text-xl font-semibold">{renderInline(node)}</div>;
    if (node.type === 'bulletList') return <ul className="list-disc pl-5" key={node.attrs.id}>{node.content.map(render)}</ul>;
    if (node.type === 'orderedList') return <ol className="list-decimal pl-5" start={node.attrs.start} key={node.attrs.id}>{node.content.map(render)}</ol>;
    if (node.type === 'listItem') return <li key={node.attrs.id}>{node.content.map(render)}</li>;
    return <blockquote className="border-l-2 pl-4" key={node.attrs.id}>{node.content.map(render)}</blockquote>;
  };
  return <div className="space-y-6 break-words [&_p]:my-3 [&_figure]:my-4">{composition.segments.map(segment => <section key={segment.id}>{segment.content.map(render)}</section>)}</div>;
}
