"use client";
/** Typed slot options, explicit preflight and retained candidate review. [COMP:app-web/feed-generation-placeholder] */
import { useEffect, useRef, useState } from 'react';
import { feedMediaSchema, type FeedCommand, type FeedEdit, type FeedGenerationEstimate, type FeedPlaceholderAttrs, type FeedNode, type FeedEditorialRunSummary } from '@use-brian/shared';
import { feedText, importFeedMarkdown, canonicalFeedValue, walkFeed } from '@use-brian/doc-model';
import { useLocale, useT } from '@/lib/i18n/client';
import { authFetch } from '@/lib/auth-fetch';
import { publicRuntimeConfig } from '@/lib/runtime-public-config';
import { feedCollaborationPath, type FeedCollaborationSnapshot, type FeedDraftSuggestion } from '@/lib/feed-collaboration';
import { usePostMedia } from '@/lib/use-post-media';
import { ACCEPTED_MEDIA_MIME } from '@/lib/feed-media';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useCachedResource } from '@/lib/surface-cache';
import { listBrain } from '@/lib/api/brain';
import { feedOwner } from '@/lib/offline/feed-cache';
import { fetchDocFileBlob } from '@/components/doc/doc-file-url';
const button = 'min-h-11 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50';
const inputClass = 'min-h-11 w-full rounded-md border bg-background p-2 text-base';
export type FeedGenerationControls = { workspaceId: string; assistantId: string; sessionId: string; revision: number; offline: boolean; pending: boolean; readOnly: boolean; article: boolean; snapshot?: FeedCollaborationSnapshot | null; onCommand: (commands: FeedCommand[]) => Promise<boolean>; onRefresh: () => void };
export function GenerationPlaceholder(props: { slot: FeedPlaceholderAttrs; segmentId: string; controls: FeedGenerationControls; onEdit: (edits: FeedEdit[]) => void; onSelect: () => void; onAction: (action: 'comment' | 'suggest' | 'ask') => void }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const tr = useT().feedReview; const locale = useLocale(); const c = props.controls;
  const [manual, setManual] = useState(''); const [link, setLink] = useState(''); const [files, setFiles] = useState<'reference' | 'image' | null>(null);
  const [model, setModel] = useState<'standard' | 'pro' | 'max'>('standard'); const [count, setCount] = useState(1);
  const [estimate, setEstimate] = useState<FeedGenerationEstimate | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const retained = useRef<{ key: string; mutationId: string } | null>(null); const dispatchIds = useRef(new Map<string, string>()); const uploadInput = useRef<HTMLInputElement>(null);
  const media = usePostMedia(c.workspaceId); const node: FeedNode = { type: 'generationPlaceholder', attrs: props.slot };
  const remoteBlocked = c.readOnly || c.offline || c.pending || busy; const runs = c.snapshot?.runs?.filter(run => run.generation?.slotId === props.slot.id) ?? [];
  const active = runs.some(run => run.status === 'pending' || run.status === 'running');
  const candidates = c.snapshot?.suggestions.filter(s => s.sourceRunId && s.edits.some(edit => edit.kind === 'replaceBlock' && edit.blockId === props.slot.id)) ?? [];
  const replace = (replacement: FeedNode[]) => props.onEdit([{ kind: 'replaceBlock', segmentId: props.segmentId, blockId: props.slot.id, preimage: node, replacement }]);
  const update = (patch: Partial<FeedPlaceholderAttrs>) => { setEstimate(null); replace([{ type: 'generationPlaceholder', attrs: { ...props.slot, ...patch, briefRevision: props.slot.briefRevision + 1 } }]); };
  async function request(suffix: string, body: unknown) {
    const res = await authFetch(`${publicRuntimeConfig().apiUrl ?? 'http://localhost:4000'}${feedCollaborationPath(c.assistantId, c.sessionId)}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw new Error(data.code ?? 'generation_failed'); return data;
  }
  async function estimateGeneration() {
    if (remoteBlocked || active) return; setBusy(true); setError(null);
    const body = { expectedRevision: c.revision, segmentId: props.segmentId, slotId: props.slot.id, model, count: props.slot.kind === 'image' ? 1 : count, locale };
    const key = JSON.stringify(body); if (retained.current?.key !== key) retained.current = { key, mutationId: crypto.randomUUID() };
    try { setEstimate((await request('/generations/estimate', { ...body, mutationId: retained.current.mutationId })).estimate); retained.current = null; }
    catch (err) { setError(err instanceof Error && err.message.includes('unavailable') ? t.unavailable : t.failed); } finally { setBusy(false); c.onRefresh(); }
  }
  async function dispatch() {
    if (!estimate || remoteBlocked || active || estimate.revision !== c.revision) return;
    setBusy(true); setError(null); const mutationId = dispatchIds.current.get(estimate.id) ?? crypto.randomUUID(); dispatchIds.current.set(estimate.id, mutationId);
    try { await request('/generations', { mutationId, estimateId: estimate.id, confirmed: true }); setEstimate(null); }
    catch { setError(t.failed); } finally { setBusy(false); c.onRefresh(); }
  }
  function fillImage(fileId: string, mimeType: string) {
    const parsed = feedMediaSchema.safeParse({ fileId, mimeType, alt: props.slot.altIntent ?? '' });
    if (!parsed.success) { setError(t.imageRequired); return; }
    replace([{ type: 'image', attrs: { ...parsed.data, id: props.slot.id, placement: c.article ? 'inline' : 'attachment' } }]);
  }
  return <section data-feed-slot={props.slot.id} className="my-3 min-w-0 space-y-3 rounded-xl border border-dashed bg-muted/30 p-3" onPointerDown={props.onSelect} onFocusCapture={props.onSelect}>
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{props.slot.kind === 'text' ? t.textSlot : t.imageSlot}</strong><span className="text-xs">{t.unfilled}</span></div>
    <label className="block space-y-1 text-sm"><span>{t.brief}</span><textarea aria-label={t.brief} className={inputClass} value={props.slot.brief} disabled={c.readOnly} rows={3} onChange={e => update({ brief: e.target.value })} /></label>
    <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.advanced}</summary>
      {props.slot.kind === 'text' ? <>
        <label className="block text-sm">{t.intent}<input className={inputClass} value={props.slot.intent ?? ''} disabled={c.readOnly} onChange={e => update({ intent: e.target.value })} /></label>
        <label className="block text-sm">{t.length}<input type="number" min={1} max={100000} className={inputClass} value={props.slot.length ?? ''} disabled={c.readOnly} onChange={e => { const value = Number(e.target.value); if (!e.target.value || (Number.isInteger(value) && value >= 1 && value <= 100000)) update({ length: e.target.value ? value : undefined }); }} /></label>
      </> : <>
        <SearchableSelect aria-label={t.aspectRatio} value={props.slot.aspectRatio ?? '1:1'} disabled={c.readOnly} items={['1:1', '16:9', '9:16', '4:3', '3:4'].map(value => ({ value, label: value }))} onValueChange={value => update({ aspectRatio: value as FeedPlaceholderAttrs['aspectRatio'] })} />
        <label className="block text-sm">{t.style}<input className={inputClass} value={props.slot.style ?? ''} disabled={c.readOnly} onChange={e => update({ style: e.target.value })} /></label>
        <label className="block text-sm">{t.altIntent}<input className={inputClass} value={props.slot.altIntent ?? ''} disabled={c.readOnly} onChange={e => update({ altIntent: e.target.value })} /></label>
      </>}
      <p className="text-xs text-muted-foreground">{t.referenceHint}</p>
      <ul className="space-y-1 text-xs">{props.slot.references.map((ref, i) => <li className="flex gap-2 break-all" key={i}><span>{'url' in ref ? ref.url : ref.fileId}</span><button className={button} disabled={c.readOnly} onClick={() => update({ references: props.slot.references.filter((_, index) => index !== i) })}>{tc.deleteBlock}</button></li>)}</ul>
      <label className="block text-sm">{t.referenceLink}<input className={inputClass} value={link} onChange={e => setLink(e.target.value)} disabled={c.readOnly} /></label>
      <button className={button} disabled={c.readOnly || props.slot.references.length >= 20} onClick={() => { try { if (!/^https?:\/\//i.test(link)) return; new URL(link); update({ references: [...props.slot.references, { url: link }] }); setLink(''); } catch { setError(t.failed); } }}>{t.addReference}</button>
      <button className={button} disabled={remoteBlocked || props.slot.references.length >= 20} onClick={() => setFiles('reference')}>{t.chooseFile}</button>
    </details>
    {props.slot.kind === 'text' ? <details><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.manualText}</summary><textarea className={inputClass} aria-label={t.manualText} value={manual} onChange={e => setManual(e.target.value)} disabled={c.readOnly} /><button className={button} disabled={c.readOnly || !manual.trim()} onClick={() => { const nodes = importFeedMarkdown(manual); nodes[0]!.attrs.id = props.slot.id; replace(nodes); }}>{t.fillText}</button></details> : <div className="flex flex-wrap gap-2">
      <input hidden ref={uploadInput} type="file" accept={ACCEPTED_MEDIA_MIME.join(',')} onChange={e => { const file = e.target.files?.[0]; if (file) void media.upload([file]).then(result => { if (result.media[0]) fillImage(result.media[0].fileId, result.media[0].mimeType); if (result.errors.length) setError(t.failed); }); e.currentTarget.value = ''; }} />
      <button className={button} disabled={remoteBlocked || media.uploading} onClick={() => uploadInput.current?.click()}>{t.uploadImage}</button>
      <button className={button} disabled={remoteBlocked} onClick={() => setFiles('image')}>{t.chooseFile}</button>
    </div>}
    {files ? <FeedGenerationFilePicker controls={c} onCancel={() => setFiles(null)} onPick={async id => { if (files === 'reference') update({ references: [...props.slot.references, { fileId: id }] }); else { try { const blob = await fetchDocFileBlob(c.workspaceId, id); fillImage(id, blob.type); } catch { setError(t.imageRequired); } } setFiles(null); }} /> : null}
    {props.slot.kind === 'text' ? <div className="flex flex-wrap gap-2" role="group" aria-label={t.model}>{(['standard', 'pro', 'max'] as const).map(tier => <button className={button} key={tier} disabled={remoteBlocked || active} aria-pressed={model === tier} onClick={() => { setModel(tier); setEstimate(null); }}>{tr[tier]}</button>)}</div> : null}
    {props.slot.kind === 'text' ? <label className="block text-sm">{t.candidates}<input className={inputClass} type="number" min={1} max={5} value={count} disabled={remoteBlocked || active} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 1 && value <= 5) { setCount(value); setEstimate(null); } }} /></label> : null}
    <button className={button} disabled={remoteBlocked || active || !props.slot.brief.trim()} onClick={() => void estimateGeneration()}>{runs.length ? t.tryAgain : t.generate}</button>
    {c.offline ? <p role="status" className="text-sm">{tr.offline}</p> : c.pending ? <p role="status" className="text-sm">{tc.syncFirst}</p> : null}
    {busy ? <p role="status" className="text-sm">{t.loading}</p> : null}{error ? <p role="alert" className="text-sm">{error}</p> : null}
    {estimate ? <section className="space-y-2 rounded-lg border bg-background p-3" aria-label={t.estimateTitle}>
      <h4 className="font-medium">{t.estimateTitle}</h4><p className="whitespace-pre-wrap text-sm">{estimate.slot.brief}</p><p className="text-sm">{t.model}: {estimate.model} · {t.candidates}: {estimate.count}</p>
      <p className="text-sm">{t.estimatedCost}: {estimate.price.maximumUsd === null ? t.costUnknown : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(estimate.price.maximumUsd)}</p>
      <p className="text-xs">{estimate.price.billing === 'byo' ? t.costByo : estimate.price.billing === 'metered' ? t.costMetered : t.costIncluded}{estimate.price.credits !== undefined ? ` ${t.credits}: ${estimate.price.credits}` : ''}</p>
      <dl className="text-sm">{(['intent', 'length', 'aspectRatio', 'style', 'altIntent'] as const).map(key => estimate.slot[key] !== undefined ? <div key={key}><dt className="font-medium">{t[key]}</dt><dd>{estimate.slot[key]}</dd></div> : null)}</dl>
      <p className="text-sm">{t.confirmShape}</p><p className="text-xs">{t.sources}: {estimate.sources.map(source => source.title).join(', ') || tr.unavailable}</p>
      {estimate.omissions.length ? <p className="text-sm">{t.referenceOmissions}</p> : null}
      <button className={button} disabled={remoteBlocked || active || estimate.revision !== c.revision} onClick={() => void dispatch()}>{t.confirm}</button><button className={button} onClick={() => setEstimate(null)}>{tc.cancel}</button>
    </section> : null}
    <FeedGenerationResults controls={c} runs={runs} candidates={candidates} slot={props.slot} onRunAction={async (id, action) => { try { await request(`/runs/${id}/${action}`, {}); } catch { setError(t.failed); } c.onRefresh(); }} />
    <div className="flex flex-wrap gap-2">{(['comment', 'suggest', 'ask'] as const).map(action => <button key={action} className={button} disabled={c.readOnly} onClick={() => props.onAction(action)}>{action === 'comment' ? tc.comment : action === 'suggest' ? tc.suggest : tc.askBrian}</button>)}</div>
  </section>;
}
function FeedGenerationFilePicker({ controls: c, onPick, onCancel }: { controls: FeedGenerationControls; onPick: (id: string) => Promise<void>; onCancel: () => void }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const [search, setSearch] = useState('');
  const key = `brain-entry:${c.workspaceId}:feed-files:${feedOwner()}:${c.assistantId}:${search}`;
  const files = useCachedResource(key, () => listBrain({ workspaceId: c.workspaceId, viewpointAssistantId: c.assistantId, primitives: ['files'], search, limit: 50, failOnError: true }));
  return <section className="space-y-2 rounded-lg border bg-background p-3"><input className={inputClass} aria-label={t.searchFiles} value={search} onChange={e => setSearch(e.target.value)} />
    {files.loading ? <p role="status">{t.loading}</p> : files.error ? <p role="alert">{t.failed}<button className={button} onClick={() => void files.refresh()}>{tc.retry}</button></p> : <div className="max-h-60 overflow-y-auto">{files.data?.rows.length ? files.data.rows.map(file => <button className="block min-h-11 w-full rounded-md border p-2 text-left text-sm" key={file.id} onClick={() => void onPick(file.id)}>{file.name}</button>) : <p>{t.noFiles}</p>}</div>}
    {files.data?.nextCursor ? <p className="text-xs">{t.moreFiles}</p> : null}<button className={button} onClick={onCancel}>{tc.cancel}</button>
  </section>;
}
export function FeedGenerationResults({ controls: c, runs, candidates, slot, onRunAction }: { controls: FeedGenerationControls; runs: FeedEditorialRunSummary[]; candidates: FeedDraftSuggestion[]; slot?: FeedPlaceholderAttrs; onRunAction: (id: string, action: 'retry' | 'cancel') => Promise<void> }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const tr = useT().feedReview; const disabled = c.readOnly || c.offline || c.pending;
  return <div className="space-y-3">
    {runs.map(run => <div key={run.id} className="space-y-2 border-t pt-2 text-sm"><p>{tr[run.status]}</p>{run.generation && (!slot || run.generation.briefRevision !== slot.briefRevision) ? <p className="whitespace-pre-wrap">{t.originalBrief}: {run.generation.estimate.slot.brief}</p> : null}
      {run.status === 'unknown_outcome' || run.error === 'cancelled_after_dispatch' ? <p>{tr.unknownExplanation}</p> : null}
      {run.status === 'pending' || run.status === 'running' ? <button className={button} disabled={disabled} onClick={() => void onRunAction(run.id, 'cancel')}>{tc.cancel}</button> : null}
      {run.status === 'failed' && run.attempts < 3 ? <button className={button} disabled={disabled} onClick={() => void onRunAction(run.id, 'retry')}>{tc.retry}</button> : null}
    </div>)}
    {candidates.map(candidate => {
      const edit = candidate.edits[0]; const stale = !slot || edit?.kind !== 'replaceBlock' || canonicalFeedValue(edit.preimage) !== canonicalFeedValue({ type: 'generationPlaceholder', attrs: slot });
      const text = candidate.edits.flatMap(edit => edit.kind === 'replaceBlock' ? edit.replacement.map(feedText) : []).join('\n\n'); const actionable = ['proposed', 'deferred'].includes(candidate.status);
      return <article key={candidate.id} className="space-y-2 rounded-lg border bg-background p-3" data-feed-candidate={candidate.id}>{candidate.edits.flatMap(edit => edit.kind === 'replaceBlock' ? edit.replacement.filter(node => node.type === 'image') : []).map(node => node.type === 'image' ? <FeedGenerationImage key={node.attrs.id} workspaceId={c.workspaceId} fileId={node.attrs.fileId} alt={node.attrs.alt ?? ''} /> : null)}<p className="whitespace-pre-wrap text-sm">{text}</p><p className="text-xs text-muted-foreground">{candidate.rationale}</p>
        {stale && actionable ? <p className="text-sm">{t.stale}</p> : null}
        {actionable ? <div className="flex flex-wrap gap-2"><button className={button} disabled={disabled || stale} onClick={() => void c.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'accepted' }])}>{tc.accept}</button><button className={button} disabled={disabled} onClick={() => void c.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'rejected' }])}>{tc.reject}</button><button className={button} disabled={disabled || candidate.status === 'deferred'} onClick={() => void c.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'deferred' }])}>{t.keepLater}</button></div> : <p className="text-xs">{tc[candidate.status as 'accepted' | 'rejected'] ?? candidate.status}</p>}
      </article>;
    })}
  </div>;
}


/** Deleted or filled slots keep their jobs and candidates reachable after reload. */
export function FeedDetachedGenerationResults({ controls: c }: { controls: FeedGenerationControls }) {
  const t = useT().feedGeneration; const [error, setError] = useState<string | null>(null);
  const slots = new Set(c.snapshot?.copy?.content.composition ? walkFeed(c.snapshot.copy.content.composition).filter(item => item.node.type === 'generationPlaceholder').map(item => item.node.attrs.id) : []);
  const runs = c.snapshot?.runs?.filter(run => run.generation && !slots.has(run.generation.slotId)) ?? [];
  if (!runs.length) return null;
  return <details className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.retainedResults}</summary>
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
    <FeedGenerationResults controls={c} runs={runs} candidates={c.snapshot?.suggestions.filter(s => runs.some(run => run.id === s.sourceRunId)) ?? []} onRunAction={async (id, action) => {
      setError(null);
      try { const response = await authFetch(`${publicRuntimeConfig().apiUrl ?? 'http://localhost:4000'}${feedCollaborationPath(c.assistantId, c.sessionId)}/runs/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error(t.failed); } catch { setError(t.failed); } c.onRefresh();
    }} />
  </details>;
}

/** Authenticated durable bytes; object URLs never become composition content. */
export function FeedGenerationImage({ workspaceId, fileId, alt }: { workspaceId: string; fileId: string; alt: string }) {
  const t = useT().feedGeneration; const [url, setUrl] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let disposed = false; let objectUrl: string | null = null; setUrl(null); setFailed(false);
    void fetchDocFileBlob(workspaceId, fileId).then(blob => { if (disposed) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [workspaceId, fileId]);
  return url ? <img src={url} alt={alt} className="max-h-96 max-w-full rounded-lg object-contain" /> : <p role="status" className="min-h-11 text-sm">{failed ? t.imageUnavailable : t.loading}{alt ? `: ${alt}` : ''}</p>;
}
