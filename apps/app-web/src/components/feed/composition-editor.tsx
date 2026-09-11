"use client";
/** Feed ProseMirror authoring with stable target decorations. [COMP:app-web/feed-composition-editor] */
import { useEffect, useRef } from 'react';
import { EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { EditorView, Decoration, DecorationSet } from '@tiptap/pm/view';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from '@tiptap/pm/commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { promptDialog } from '@/components/ui/prompt-dialog';
import { keymap } from '@tiptap/pm/keymap';
import { history, undo, redo } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { feedSchema, locateFeedNode, duplicateFeedNode, diffFeedComposition, validateFeedComposition, feedTargetQuote } from '@use-brian/doc-model';
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
  composition: FeedComposition; readOnly?: boolean; threads: FeedCommentThread[]; draftAnchor?: FeedAnchor | null;
  onEdit: (edits: FeedEdit[]) => void; onSelection: (selection: FeedEditorSelection) => void;
  onAction: (action: 'comment' | 'suggest' | 'ask') => void; onOpenThread: (threadId: string) => void;
}) {
  const t = useT().feedCollaboration;
  return <div className="space-y-4" data-feed-composition>
    {props.composition.segments.map(segment => <FeedSegmentEditor key={segment.id} {...props} segmentId={segment.id} />)}
    <div role="toolbar" aria-label={t.blockActions} className="flex flex-wrap gap-2">
      {(['comment', 'suggest', 'ask'] as const).map(action => <button type="button" key={action} disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => props.onAction(action)} className="min-h-11 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">{action === 'comment' ? t.comment : action === 'suggest' ? t.suggest : t.askBrian}</button>)}
    </div>
  </div>;
}
function FeedSegmentEditor(props: Parameters<typeof CompositionEditor>[0] & { segmentId: string }) {
  const t = useT().feedCollaboration; const host = useRef<HTMLDivElement>(null); const viewRef = useRef<EditorView | null>(null); const latest = useRef(props); latest.current = props;
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
      state: EditorState.create({ schema: feedSchema, doc: feedSchema.nodeFromJSON({ type: 'doc', content: segment.content }), plugins: [history(), keymap({ 'Mod-b': toggleMark(feedSchema.marks.bold!), 'Mod-i': toggleMark(feedSchema.marks.italic!), 'Mod-z': undo, 'Mod-Shift-z': redo, ...baseKeymap, Enter: (state, dispatch, view) => splitListItem(feedSchema.nodes.listItem!)(state, dispatch) || baseKeymap.Enter!(state, dispatch, view), Tab: sinkListItem(feedSchema.nodes.listItem!), 'Shift-Tab': liftListItem(feedSchema.nodes.listItem!) }), new Plugin({ key: decorationKey, props: { decorations: state => decorations(state.doc) } })] }),
      editable: () => !latest.current.readOnly,
      attributes: { role: 'textbox', 'aria-label': t.editor, 'aria-multiline': 'true', class: 'min-h-44 rounded-xl border border-border/60 bg-card p-5 text-base leading-relaxed outline-none focus:border-ring [&_p]:my-3 [&_h1]:text-2xl [&_h2]:text-xl [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-4' },
      handleClick(_view, _pos, event) { const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-feed-thread]'); if (hit?.dataset.feedThread && hit.dataset.feedThread !== 'draft') latest.current.onOpenThread(hit.dataset.feedThread); return false; },
      dispatchTransaction(transaction: Transaction) {
        let next = view.state.apply(transaction);
        if (transaction.docChanged) {
          const seen = new Set<string>(); const identity = next.tr;
          next.doc.descendants((node, pos) => { if (!node.isBlock) return; let blockId = node.attrs.id as string | null; if (!blockId || seen.has(blockId)) { blockId = crypto.randomUUID(); identity.setNodeMarkup(pos, undefined, { ...node.attrs, id: blockId }); } seen.add(blockId); });
          if (identity.docChanged) next = next.apply(identity);
        }
        view.updateState(next);
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
  return <div className="space-y-2">
    <div role="toolbar" aria-label={t.editor} className="flex flex-wrap gap-2">
      {(['bold', 'italic'] as const).map(mark => <button key={mark} type="button" disabled={props.readOnly} aria-label={t[mark]} onMouseDown={e => e.preventDefault()} onClick={() => { const view = viewRef.current; if (view) { toggleMark(feedSchema.marks[mark]!)(view.state, view.dispatch); view.focus(); } }} className="min-h-11 min-w-11 rounded-md border px-3 text-sm hover:bg-muted">{t[mark]}</button>)}
      {(['bulletList', 'orderedList', 'heading', 'blockquote'] as const).map(kind => <button key={kind} type="button" disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => { const view = viewRef.current; if (!view) return; const command = kind === 'heading' ? setBlockType(feedSchema.nodes.heading!, { level: 2 }) : kind === 'blockquote' ? wrapIn(feedSchema.nodes.blockquote!) : wrapInList(feedSchema.nodes[kind]!); command(view.state, view.dispatch); view.focus(); }} className="min-h-11 rounded-md border px-3 text-sm hover:bg-muted">{t[kind]}</button>)}
      <button type="button" disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => { void (async () => { const view = viewRef.current; if (!view) return; const href = await promptDialog({ title: t.link, placeholder: t.linkPlaceholder, confirmLabel: t.accept, cancelLabel: t.cancel, allowEmpty: true }); if (href === null || (href && !/^https?:\/\//i.test(href))) return; try { if (href) new URL(href); else { view.dispatch(view.state.tr.removeMark(view.state.selection.from, view.state.selection.to, feedSchema.marks.link!)); return; } toggleMark(feedSchema.marks.link!, { href })(view.state, view.dispatch); view.focus(); } catch { /* Invalid URL leaves the selected content unchanged. */ } })(); }} className="min-h-11 rounded-md border px-3 text-sm hover:bg-muted">{t.link}</button>
    </div>
    <div ref={host} />
    <div role="toolbar" aria-label={t.blockActions} className="flex flex-wrap gap-2">
      {(['moveUp', 'moveDown', 'duplicate', 'deleteBlock'] as const).map(action => <button key={action} type="button" className="min-h-11 rounded-md border px-3 text-sm hover:bg-muted" disabled={props.readOnly} onMouseDown={event => event.preventDefault()} onClick={() => {
        const view = viewRef.current; if (!view) return;
        const selected = feedSelectionFromEditor(view.state, props.segmentId, local.current); const blockId = selected.caret?.blockId ?? (selected.target.kind === 'block' ? selected.target.blockId : undefined); if (!blockId) return;
        const { node, siblings, index, parentId } = locateFeedNode(local.current, props.segmentId, blockId);
        if (action === 'duplicate') latest.current.onEdit([{ kind: 'insertBlock', segmentId: props.segmentId, parentId, afterId: blockId, node: duplicateFeedNode(node) }]);
        else if (action === 'deleteBlock') { let position: number | undefined; view.state.doc.descendants((item, pos) => { if (item.attrs.id === blockId) position = pos; }); if (position !== undefined) view.dispatch(view.state.tr.delete(position, position + feedSchema.nodeFromJSON(node).nodeSize)); }
        else if ((action === 'moveUp' && index > 0) || (action === 'moveDown' && index < siblings.length - 1)) latest.current.onEdit([{ kind: 'moveBlock', segmentId: props.segmentId, blockId, parentId, afterId: action === 'moveUp' ? siblings[index - 2]?.attrs.id ?? null : siblings[index + 1]!.attrs.id }]);
      }}>{t[action]}</button>)}
    </div>
  </div>;
}
