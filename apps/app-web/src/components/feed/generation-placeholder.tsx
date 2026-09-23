"use client";
import { Dialog } from '@base-ui/react/dialog';
import { ChevronLeft, ChevronRight, ImagePlus, TextCursorInput, MoreHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
/** Typed slot options, explicit preflight and retained candidate review. [COMP:app-web/feed-generation-placeholder] */
import { useEffect, useRef, useState } from 'react';
import { feedMediaSchema, type FeedCommand, type FeedEdit, type FeedGenerationEstimate, type FeedPlaceholderAttrs, type FeedNode, type FeedEditorialRunSummary } from '@use-brian/shared';
import { feedText, importFeedMarkdown, canonicalFeedValue, walkFeed } from '@use-brian/doc-model';
import { useLocale, useT } from '@/lib/i18n/client';
import { format } from '@/lib/i18n/format';
import { authFetch } from '@/lib/auth-fetch';
import { publicRuntimeConfig } from '@/lib/runtime-public-config';
import { feedCollaborationPath, type FeedCollaborationSnapshot, type FeedDraftSuggestion } from '@/lib/feed-collaboration';
import { usePostMedia } from '@/lib/use-post-media';
import { ACCEPTED_MEDIA_MIME } from '@/lib/feed-media';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useCachedResource } from '@/lib/surface-cache';
import { listBrain, type BrainRow } from '@/lib/api/brain';
import { feedOwner } from '@/lib/offline/feed-cache';
import { fetchDocFileBlob } from '@/components/doc/doc-file-url';
const inputClass = 'min-h-11 w-full rounded-md border bg-background p-2 text-base';
export type FeedGenerationControls = { workspaceId: string; assistantId: string; sessionId: string; revision: number; offline: boolean; pending: boolean; readOnly: boolean; article: boolean; snapshot?: FeedCollaborationSnapshot | null; onCommand: (commands: FeedCommand[]) => Promise<boolean>; onRefresh: () => void };
type FeedImageNode = Extract<FeedNode, { type: 'image' }>;
function candidateImage(candidate: FeedDraftSuggestion): FeedImageNode | null {
  for (const edit of candidate.edits) {
    if (edit.kind !== 'replaceBlock') continue;
    const image = edit.replacement.find((node): node is FeedImageNode => node.type === 'image');
    if (image) return image;
  }
  return null;
}
function candidateMatchesSlot(candidate: FeedDraftSuggestion, slot: FeedPlaceholderAttrs): boolean {
  const edit = candidate.edits.find(item => item.kind === 'replaceBlock' && item.blockId === slot.id);
  return edit?.kind === 'replaceBlock' && canonicalFeedValue(edit.preimage) === canonicalFeedValue({ type: 'generationPlaceholder', attrs: slot });
}
export function GenerationPlaceholder(props: { slot: FeedPlaceholderAttrs; segmentId: string; controls: FeedGenerationControls; onEdit: (edits: FeedEdit[]) => void; onSelect: () => void; onContinue?: () => void }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const tr = useT().feedReview; const locale = useLocale(); const c = props.controls;
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(''); const [link, setLink] = useState(''); const [files, setFiles] = useState<'reference' | 'image' | null>(null);
  const [imageProvider, setImageProvider] = useState<'gemini' | 'openai-codex'>('gemini');
  const [model, setModel] = useState<'standard' | 'pro' | 'max'>('standard'); const [count, setCount] = useState(1);
  const [estimate, setEstimate] = useState<FeedGenerationEstimate | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0); const [iteration, setIteration] = useState('');
  const retained = useRef<{ key: string; mutationId: string } | null>(null); const dispatchIds = useRef(new Map<string, string>());
  const referenceUploadInput = useRef<HTMLInputElement>(null); const imageUploadInput = useRef<HTMLInputElement>(null);
  const media = usePostMedia(c.workspaceId); const node: FeedNode = { type: 'generationPlaceholder', attrs: props.slot };
  const generationBlocked = c.readOnly || c.offline || c.pending || busy; const fileBlocked = c.readOnly || c.offline || c.pending || media.uploading;
  const runs = c.snapshot?.runs?.filter(run => run.generation?.slotId === props.slot.id) ?? [];
  const active = runs.some(run => run.status === 'pending' || run.status === 'running');
  const candidates = c.snapshot?.suggestions.filter(s => s.sourceRunId && s.edits.some(edit => edit.kind === 'replaceBlock' && edit.blockId === props.slot.id)) ?? [];
  const imageCandidates = props.slot.kind === 'image' ? candidates.filter(candidate => candidateImage(candidate) !== null).sort((left, right) => Number(['proposed', 'deferred'].includes(right.status) && candidateMatchesSlot(right, props.slot)) - Number(['proposed', 'deferred'].includes(left.status) && candidateMatchesSlot(left, props.slot))) : [];
  const imageCandidateKey = imageCandidates.map(candidate => candidate.id).join(':');
  const pendingImageCandidate = imageCandidates.find(candidate => ['proposed', 'deferred'].includes(candidate.status) && candidateMatchesSlot(candidate, props.slot));
  const pendingImage = pendingImageCandidate ? candidateImage(pendingImageCandidate) : null;
  useEffect(() => { setImageIndex(0); }, [imageCandidateKey]);
  const replace = (replacement: FeedNode[]) => props.onEdit([{ kind: 'replaceBlock', segmentId: props.segmentId, blockId: props.slot.id, preimage: node, replacement }]);
  const update = (patch: Partial<FeedPlaceholderAttrs>) => { setEstimate(null); replace([{ type: 'generationPlaceholder', attrs: { ...props.slot, ...patch, briefRevision: props.slot.briefRevision + 1 } }]); };
  async function request(suffix: string, body: unknown) {
    const res = await authFetch(`${publicRuntimeConfig().apiUrl ?? 'http://localhost:4000'}${feedCollaborationPath(c.assistantId, c.sessionId)}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw new Error(data.code ?? 'generation_failed'); return data;
  }
  async function estimateGeneration() {
    if (generationBlocked || active) return; setBusy(true); setError(null);
    const body = { expectedRevision: c.revision, segmentId: props.segmentId, slotId: props.slot.id, model, ...(props.slot.kind === 'image' ? { imageProvider } : {}), count: props.slot.kind === 'image' ? 1 : count, locale };
    const key = JSON.stringify(body); if (retained.current?.key !== key) retained.current = { key, mutationId: crypto.randomUUID() };
    try { setEstimate((await request('/generations/estimate', { ...body, mutationId: retained.current.mutationId })).estimate); retained.current = null; }
    catch (err) { setError(err instanceof Error && err.message.includes('unavailable') ? t.unavailable : t.failed); } finally { setBusy(false); c.onRefresh(); }
  }
  async function dispatch() {
    if (!estimate || generationBlocked || active || estimate.revision !== c.revision) return;
    setBusy(true); setError(null); const mutationId = dispatchIds.current.get(estimate.id) ?? crypto.randomUUID(); dispatchIds.current.set(estimate.id, mutationId);
    try { await request('/generations', { mutationId, estimateId: estimate.id, confirmed: true }); setEstimate(null); }
    catch { setError(t.failed); } finally { setBusy(false); c.onRefresh(); }
  }
  function fillImage(fileId: string, mimeType: string) {
    const parsed = feedMediaSchema.safeParse({ fileId, mimeType, alt: props.slot.altIntent ?? '' });
    if (!parsed.success) { setError(t.imageRequired); return; }
    replace([{ type: 'image', attrs: { ...parsed.data, id: props.slot.id, placement: c.article ? 'inline' : 'attachment' } }]);
  }
  function addFileReference(fileId: string) {
    if (props.slot.references.length >= 20) return;
    update({ references: [...props.slot.references, { fileId }] });
  }
  async function uploadReference(file: File) {
    const result = await media.upload([file]);
    if (result.media[0]) addFileReference(result.media[0].fileId);
    if (result.errors.length) setError(t.failed);
  }
  async function uploadImage(file: File) {
    const result = await media.upload([file]);
    if (result.media[0]) fillImage(result.media[0].fileId, result.media[0].mimeType);
    if (result.errors.length) setError(t.failed);
  }
  const Icon = props.slot.kind === 'text' ? TextCursorInput : ImagePlus;
  const label = props.slot.kind === 'text' ? t.textSlot : t.imageSlot;
  const imageProviders = [{ value: 'gemini', label: t.imageGemini }, ...(publicRuntimeConfig().edition === 'oss' ? [{ value: 'openai-codex', label: t.imageCodex }] : [])];
  const waiting = candidates.some(candidate => ['proposed', 'deferred'].includes(candidate.status));
  const referenceControls = <section className="space-y-3" aria-label={t.references}>
    <div><h3 className="text-sm font-medium">{t.references}</h3><p className="text-xs text-muted-foreground">{t.referenceHint}</p></div>
    <ul className="space-y-2 text-xs">{props.slot.references.map((ref, i) => <li className="flex min-w-0 items-center gap-3" key={i}>
      {'url' in ref ? <span className="min-w-0 flex-1 break-all">{ref.url}</span> : <div className="min-w-0 flex-1" data-feed-reference-image><FeedGenerationImage workspaceId={c.workspaceId} fileId={ref.fileId} alt={t.imagePreview} className="h-24 w-24 rounded-lg border object-cover" /></div>}
      <Button variant="outline" size="sm" className="min-h-11 shrink-0 md:min-h-8" disabled={c.readOnly} onClick={() => update({ references: props.slot.references.filter((_, index) => index !== i) })}>{tc.deleteBlock}</Button>
    </li>)}</ul>
    <label className="block space-y-1 text-sm"><span>{t.referenceLink}</span><input className={inputClass} value={link} onChange={e => setLink(e.target.value)} disabled={c.readOnly} /></label>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={c.readOnly || props.slot.references.length >= 20 || !link.trim()} onClick={() => { try { if (!/^https?:\/\//i.test(link)) return; new URL(link); update({ references: [...props.slot.references, { url: link }] }); setLink(''); } catch { setError(t.failed); } }}>{t.addReference}</Button>
      {props.slot.kind === 'image' ? <><input aria-label={t.uploadReference} hidden ref={referenceUploadInput} type="file" accept={ACCEPTED_MEDIA_MIME.join(',')} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadReference(file); e.currentTarget.value = ''; }} /><Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={fileBlocked || props.slot.references.length >= 20} onClick={() => referenceUploadInput.current?.click()}>{t.uploadReference}</Button></> : null}
      <Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={c.readOnly || c.offline || c.pending || props.slot.references.length >= 20} onClick={() => setFiles('reference')}>{t.chooseReference}</Button>
    </div>
    {files === 'reference' ? <FeedGenerationFilePicker controls={c} onCancel={() => setFiles(null)} onPick={async id => { addFileReference(id); setFiles(null); }} /> : null}
  </section>;
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <section data-feed-slot={props.slot.id} className="my-3 flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg bg-muted/40 px-3 py-1" onPointerDown={props.onSelect} onFocusCapture={props.onSelect}>
      {pendingImage ? <div className="order-first w-full pt-2" data-feed-pending-image><FeedGenerationImage workspaceId={c.workspaceId} fileId={pendingImage.attrs.fileId} alt={pendingImage.attrs.alt ?? ''} className="max-h-48 w-full rounded-lg object-contain" /></div> : null}
      <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</span>
      <input aria-label={t.brief} title={props.slot.brief || t.briefHint} placeholder={t.briefHint} value={props.slot.brief} disabled={c.readOnly}
        className="order-last min-h-11 w-full min-w-0 border-0 bg-transparent text-base shadow-none outline-none focus-visible:shadow-none md:order-none md:w-auto md:flex-1"
        onChange={event => update({ brief: event.target.value })}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); props.onContinue?.(); } }} />
      {active || waiting ? <span role="status" className="ml-auto text-xs text-muted-foreground">{active ? tr.running : t.reviewReady}</span> : null}
      <Dialog.Trigger aria-label={t.openDetails} title={t.openDetails} render={<Button variant="ghost" size="icon" className="ml-auto size-11 shrink-0 md:ml-0" />}><MoreHorizontal className="size-4" aria-hidden /></Dialog.Trigger>
    </section>
    <Dialog.Portal>
      <Dialog.Backdrop data-feed-generation-backdrop onClick={() => setOpen(false)} className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      <Dialog.Popup className="fixed left-1/2 top-1/2 z-[101] max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-background p-5 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-3"><Dialog.Title className="text-base font-semibold">{label}</Dialog.Title><Dialog.Close aria-label={t.closeDetails} render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}><X className="size-4" aria-hidden /></Dialog.Close></div>
        {imageCandidates.length ? <FeedImageCandidateCarousel controls={c} runs={runs} candidates={imageCandidates} slot={props.slot} index={imageIndex} onIndexChange={setImageIndex} iteration={iteration} onIterationChange={setIteration} onPrepareIteration={() => {
          const instruction = iteration.trim(); if (!instruction) return;
          update({ brief: [props.slot.brief.trim(), `${t.revisionPrefix}: ${instruction}`].filter(Boolean).join('\n\n') }); setIteration('');
        }} /> : null}
        <Dialog.Description className="mb-5 text-sm text-muted-foreground">{props.slot.kind === 'image' ? t.imageInstructions : t.draftFirst}</Dialog.Description>
        <div className="space-y-3" onFocusCapture={props.onSelect}>
    <label className="block space-y-1 text-sm"><span>{t.brief}</span><textarea aria-label={t.brief} className={inputClass} value={props.slot.brief} disabled={c.readOnly} rows={3} onChange={e => update({ brief: e.target.value })} /></label>
    {props.slot.kind === 'text' ? <><details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.advanced}</summary>
        <label className="block text-sm">{t.intent}<input className={inputClass} value={props.slot.intent ?? ''} disabled={c.readOnly} onChange={e => update({ intent: e.target.value })} /></label>
        <label className="block text-sm">{t.length}<input type="number" min={1} max={100000} className={inputClass} value={props.slot.length ?? ''} disabled={c.readOnly} onChange={e => { const value = Number(e.target.value); if (!e.target.value || (Number.isInteger(value) && value >= 1 && value <= 100000)) update({ length: e.target.value ? value : undefined }); }} /></label>
        {referenceControls}
      </details>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.manualText}</summary><textarea className={inputClass} aria-label={t.manualText} value={manual} onChange={e => setManual(e.target.value)} disabled={c.readOnly} /><Button variant="default" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={c.readOnly || !manual.trim()} onClick={() => { const nodes = importFeedMarkdown(manual); nodes[0]!.attrs.id = props.slot.id; replace(nodes); }}>{t.fillText}</Button></details>
    </> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label className="block text-sm">{t.imageSize}</label><SearchableSelect className="min-h-11 text-base" popupClassName="z-[110] [&_[role=option]]:min-h-11 [&_input]:text-base" aria-label={t.imageSize} value={props.slot.aspectRatio ?? '1:1'} disabled={c.readOnly} items={['1:1', '16:9', '9:16', '4:3', '3:4'].map(value => ({ value, label: value }))} onValueChange={value => update({ aspectRatio: value as FeedPlaceholderAttrs['aspectRatio'] })} /></div>
        <div className="space-y-1"><label className="block text-sm">{t.imageProvider}</label>{imageProviders.length > 1 ? <SearchableSelect aria-label={t.imageProvider} className="min-h-11 text-base" popupClassName="z-[110] [&_[role=option]]:min-h-11" value={imageProvider}
          disabled={c.readOnly || active || busy} items={imageProviders} onValueChange={value => { setImageProvider(value as 'gemini' | 'openai-codex'); setEstimate(null); setError(null); }} /> : <div aria-label={t.imageProvider} className="flex min-h-11 items-center rounded-md border bg-muted/40 px-3 text-sm">{imageProviders[0]!.label}</div>}</div>
      </div>
      {imageProvider === 'openai-codex' ? <p className="text-xs text-muted-foreground">{t.codexConnection}</p> : null}
      <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.imageDetails}</summary>
        <label className="block text-sm">{t.style}<input className={inputClass} value={props.slot.style ?? ''} disabled={c.readOnly} onChange={e => update({ style: e.target.value })} /></label>
        <label className="block text-sm">{t.altIntent}<input className={inputClass} value={props.slot.altIntent ?? ''} disabled={c.readOnly} onChange={e => update({ altIntent: e.target.value })} /></label>
      </details>
      {referenceControls}
      <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">{t.useExistingImage}</summary>
        <p className="text-xs text-muted-foreground">{t.useExistingImageHint}</p>
        <div className="flex flex-wrap gap-2"><input aria-label={t.uploadImage} hidden ref={imageUploadInput} type="file" accept={ACCEPTED_MEDIA_MIME.join(',')} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadImage(file); e.currentTarget.value = ''; }} />
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={fileBlocked} onClick={() => imageUploadInput.current?.click()}>{t.uploadImage}</Button>
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={c.readOnly || c.offline || c.pending} onClick={() => setFiles('image')}>{t.chooseImage}</Button>
        </div>
        {files === 'image' ? <FeedGenerationFilePicker controls={c} onCancel={() => setFiles(null)} onPick={async id => { try { const blob = await fetchDocFileBlob(c.workspaceId, id); fillImage(id, blob.type); } catch { setError(t.imageRequired); } setFiles(null); }} /> : null}
      </details>
    </>}
    {props.slot.kind === 'text' ? <div className="flex flex-wrap gap-2" role="group" aria-label={t.model}>{(['standard', 'pro', 'max'] as const).map(tier => <Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" key={tier} disabled={generationBlocked || active} aria-pressed={model === tier} onClick={() => { setModel(tier); setEstimate(null); }}>{tr[tier]}</Button>)}</div> : null}
    {props.slot.kind === 'text' ? <label className="block text-sm">{t.candidates}<input className={inputClass} type="number" min={1} max={5} value={count} disabled={generationBlocked || active} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 1 && value <= 5) { setCount(value); setEstimate(null); } }} /></label> : null}
    <Button variant="default" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={generationBlocked || active || !props.slot.brief.trim()} onClick={() => void estimateGeneration()}>{runs.length ? t.tryAgain : t.generate}</Button>
    {c.offline ? <p role="status" className="text-sm">{tr.offline}</p> : c.pending ? <p role="status" className="text-sm text-muted-foreground">{t.savingDraft}</p> : null}
    {busy ? <p role="status" className="text-sm">{t.loading}</p> : null}{error ? <p role="alert" className="text-sm">{error}</p> : null}
    {estimate ? <section className="space-y-2 rounded-lg border bg-background p-3" aria-label={t.estimateTitle}>
      <h4 className="font-medium">{t.estimateTitle}</h4><p className="whitespace-pre-wrap text-sm">{estimate.slot.brief}</p><p className="text-sm">{t.model}: {estimate.model} · {t.candidates}: {estimate.count}</p>
      <p className="text-sm">{estimate.price.billing === 'subscription' ? t.quotaUsage : t.estimatedCost}: {estimate.price.billing === 'subscription' ? t.quotaUnknown : estimate.price.maximumUsd === null ? t.costUnknown : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(estimate.price.maximumUsd)}</p>
      <p className="text-xs">{estimate.price.billing === 'subscription' ? t.costSubscription : estimate.price.billing === 'byo' ? t.costByo : estimate.price.billing === 'metered' ? t.costMetered : t.costIncluded}{estimate.price.credits !== undefined ? ` ${t.credits}: ${estimate.price.credits}` : ''}</p>
      <dl className="text-sm">{(['intent', 'length', 'aspectRatio', 'style', 'altIntent'] as const).map(key => estimate.slot[key] !== undefined ? <div key={key}><dt className="font-medium">{t[key]}</dt><dd>{estimate.slot[key]}</dd></div> : null)}</dl>
      <p className="text-sm">{t.confirmShape}</p><p className="text-xs">{t.sources}: {estimate.sources.map(source => source.title).join(', ') || tr.unavailable}</p>
      {estimate.omissions.length ? <p className="text-sm">{t.referenceOmissions}</p> : null}
      <Button variant="default" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={generationBlocked || active || estimate.revision !== c.revision} onClick={() => void dispatch()}>{t.confirm}</Button><Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" onClick={() => setEstimate(null)}>{tc.cancel}</Button>
    </section> : null}
    <FeedGenerationResults controls={c} runs={runs} candidates={props.slot.kind === 'image' ? candidates.filter(candidate => candidateImage(candidate) === null) : candidates} slot={props.slot} onRunAction={async (id, action) => { try { await request(`/runs/${id}/${action}`, {}); } catch { setError(t.failed); } c.onRefresh(); }} />
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
function FeedImageCandidateCarousel(props: { controls: FeedGenerationControls; runs: FeedEditorialRunSummary[]; candidates: FeedDraftSuggestion[]; slot: FeedPlaceholderAttrs; index: number; onIndexChange: (index: number) => void; iteration: string; onIterationChange: (value: string) => void; onPrepareIteration: () => void }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const candidate = props.candidates[props.index]; const swipeStart = useRef<number | null>(null);
  if (!candidate) return null;
  const image = candidateImage(candidate); if (!image) return null;
  const stale = !candidateMatchesSlot(candidate, props.slot);
  const run = props.runs.find(item => item.id === candidate.sourceRunId); const actionable = ['proposed', 'deferred'].includes(candidate.status);
  const disabled = props.controls.readOnly || props.controls.offline || props.controls.pending;
  const move = (direction: -1 | 1) => props.onIndexChange(Math.max(0, Math.min(props.candidates.length - 1, props.index + direction)));
  return <section className="mb-5 space-y-3 rounded-xl border bg-muted/20 p-3" aria-label={t.imagePreview} data-feed-image-carousel data-feed-candidate={candidate.id}>
    <div className="relative flex min-h-52 items-center justify-center overflow-hidden rounded-lg bg-muted/50"
      onTouchStart={event => { swipeStart.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={event => { const start = swipeStart.current; const end = event.changedTouches[0]?.clientX; swipeStart.current = null; if (start === null || end === undefined || Math.abs(end - start) < 40) return; move(end < start ? 1 : -1); }}>
      <FeedGenerationImage workspaceId={props.controls.workspaceId} fileId={image.attrs.fileId} alt={image.attrs.alt ?? ''} className="max-h-[42dvh] w-full rounded-lg object-contain" />
      {props.candidates.length > 1 ? <>
        <Button variant="secondary" size="icon" className="absolute left-2 size-11 rounded-full shadow-sm" aria-label={t.previousImage} disabled={props.index === 0} onClick={() => move(-1)}><ChevronLeft className="size-5" aria-hidden /></Button>
        <Button variant="secondary" size="icon" className="absolute right-2 size-11 rounded-full shadow-sm" aria-label={t.nextImage} disabled={props.index === props.candidates.length - 1} onClick={() => move(1)}><ChevronRight className="size-5" aria-hidden /></Button>
      </> : null}
    </div>
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="min-w-0 truncate" title={run?.model}>{run ? `${t.model}: ${run.model}` : t.imagePreview}</span>
      <span className="shrink-0" aria-live="polite">{format(t.imageOptionPosition, { current: props.index + 1, total: props.candidates.length })}</span>
    </div>
    {candidate.rationale ? <p className="text-sm text-muted-foreground">{candidate.rationale}</p> : null}
    {stale && actionable ? <p className="text-sm">{t.stale}</p> : null}
    {actionable ? <div className="flex flex-wrap gap-2"><Button variant="default" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={disabled || stale} onClick={() => void props.controls.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'accepted' }])}>{tc.accept}</Button><Button variant="destructive" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={disabled} onClick={() => void props.controls.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'rejected' }])}>{tc.reject}</Button><Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={disabled || candidate.status === 'deferred'} onClick={() => void props.controls.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'deferred' }])}>{t.keepLater}</Button></div> : <p className="text-xs">{tc[candidate.status as 'accepted' | 'rejected'] ?? candidate.status}</p>}
    <div className="space-y-2 rounded-lg border bg-background p-3">
      <label className="block space-y-1 text-sm"><span>{t.iterationInstruction}</span><textarea className={inputClass} rows={2} value={props.iteration} placeholder={t.iterationPlaceholder} disabled={props.controls.readOnly} onChange={event => props.onIterationChange(event.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={props.controls.readOnly || !props.iteration.trim()} onClick={props.onPrepareIteration}>{t.prepareIteration}</Button><span className="text-xs text-muted-foreground">{t.iterationHint}</span></div>
    </div>
  </section>;
}
const IMAGE_FILE_NAME = /\.(?:avif|gif|jpe?g|png|webp)$/i;
function FeedGenerationFileChoice({ controls: c, file, index, total, onPick }: { controls: FeedGenerationControls; file: BrainRow; index: number; total: number; onPick: (id: string) => Promise<void> }) {
  const t = useT().feedGeneration; const imageNamed = IMAGE_FILE_NAME.test(file.name); const [preview, setPreview] = useState<string | null>(null); const [kind, setKind] = useState<'loading' | 'image' | 'file' | 'failed'>('loading');
  useEffect(() => { let disposed = false; let objectUrl: string | null = null; setPreview(null); setKind('loading');
    void fetchDocFileBlob(c.workspaceId, file.id).then(blob => { if (disposed) return; if (!blob.type.startsWith('image/')) { setKind('file'); return; } objectUrl = URL.createObjectURL(blob); setPreview(objectUrl); setKind('image'); }).catch(() => { if (!disposed) setKind('failed'); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [c.workspaceId, file.id]);
  const imageLabel = format(t.imageOptionPosition, { current: index + 1, total }); const imageLike = imageNamed || kind === 'image';
  return <button type="button" className="flex min-h-24 min-w-0 items-center justify-center overflow-hidden rounded-md border bg-background p-2 text-left text-sm" aria-label={imageLike ? imageLabel : file.name} onClick={() => void onPick(file.id)}>
    {preview ? <img src={preview} alt="" className="h-24 w-full rounded object-cover" /> : kind === 'loading' ? <span role="status" className="text-muted-foreground">{t.loading}</span> : imageLike ? <span className="text-muted-foreground">{t.imageUnavailable}</span> : <span className="min-w-0 break-words">{file.name}</span>}
  </button>;
}
function FeedGenerationFilePicker({ controls: c, onPick, onCancel }: { controls: FeedGenerationControls; onPick: (id: string) => Promise<void>; onCancel: () => void }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const [search, setSearch] = useState('');
  const key = `brain-entry:${c.workspaceId}:feed-files:${feedOwner()}:${c.assistantId}:${search}`;
  const files = useCachedResource(key, () => listBrain({ workspaceId: c.workspaceId, viewpointAssistantId: c.assistantId, primitives: ['files'], search, limit: 50, failOnError: true }));
  return <section className="space-y-2 rounded-lg border bg-background p-3"><input className={inputClass} aria-label={t.searchFiles} value={search} onChange={e => setSearch(e.target.value)} />
    {files.loading ? <p role="status">{t.loading}</p> : files.error ? <p role="alert">{t.failed}<Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" onClick={() => void files.refresh()}>{tc.retry}</Button></p> : <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">{files.data?.rows.length ? files.data.rows.map((file, index) => <FeedGenerationFileChoice controls={c} file={file} index={index} total={files.data!.rows.length} key={file.id} onPick={onPick} />) : <p className="col-span-full">{t.noFiles}</p>}</div>}
    {files.data?.nextCursor ? <p className="text-xs">{t.moreFiles}</p> : null}<Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" onClick={onCancel}>{tc.cancel}</Button>
  </section>;
}
export function FeedGenerationResults({ controls: c, runs, candidates, slot, onRunAction }: { controls: FeedGenerationControls; runs: FeedEditorialRunSummary[]; candidates: FeedDraftSuggestion[]; slot?: FeedPlaceholderAttrs; onRunAction: (id: string, action: 'retry' | 'cancel') => Promise<void> }) {
  const t = useT().feedGeneration; const tc = useT().feedCollaboration; const tr = useT().feedReview; const locale = useLocale(); const disabled = c.readOnly || c.offline || c.pending;
  return <div className="space-y-3">
    {runs.length ? <div className="divide-y">{runs.map(run => {
      const originalBrief = run.generation && (!slot || run.generation.briefRevision !== slot.briefRevision) ? `${t.originalBrief}: ${run.generation.estimate.slot.brief}` : null;
      const uncertain = run.status === 'unknown_outcome' || run.error === 'cancelled_after_dispatch' ? tr.unknownExplanation : null;
      const detail = [originalBrief, uncertain, run.error].filter(Boolean).join(' · ');
      const timestamp = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(run.createdAt));
      return <div key={run.id} data-feed-generation-run className="flex min-h-11 min-w-0 items-center gap-2 overflow-hidden py-1 text-xs" title={detail || undefined}>
        <span className="shrink-0 font-medium">{tr[run.status]}</span>
        <time className="shrink-0 text-muted-foreground" dateTime={run.createdAt}>{timestamp}</time>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={run.model}>{run.model}</span>
        <span className="shrink-0 text-muted-foreground">×{run.attempts}</span>
        {detail ? <span className="sr-only">{detail}</span> : null}
        {run.status === 'pending' || run.status === 'running' ? <Button variant="outline" size="sm" className="min-h-11 shrink-0 px-2 md:min-h-8" disabled={disabled} onClick={() => void onRunAction(run.id, 'cancel')}>{tc.cancel}</Button> : null}
        {run.status === 'failed' && run.attempts < 3 ? <Button variant="outline" size="sm" className="min-h-11 shrink-0 px-2 md:min-h-8" disabled={disabled} onClick={() => void onRunAction(run.id, 'retry')}>{tc.retry}</Button> : null}
      </div>;
    })}</div> : null}
    {candidates.map(candidate => {
      const edit = candidate.edits[0]; const stale = !slot || edit?.kind !== 'replaceBlock' || canonicalFeedValue(edit.preimage) !== canonicalFeedValue({ type: 'generationPlaceholder', attrs: slot });
      const candidateRun = runs.find(run => run.id === candidate.sourceRunId);
      const text = candidate.edits.flatMap(edit => edit.kind === 'replaceBlock' ? edit.replacement.map(feedText) : []).join('\n\n'); const actionable = ['proposed', 'deferred'].includes(candidate.status);
      return <article key={candidate.id} className="space-y-2 rounded-lg border bg-background p-3" data-feed-candidate={candidate.id}>{candidateRun ? <p className="text-xs text-muted-foreground">{t.model}: {candidateRun.model}</p> : null}{candidate.edits.flatMap(edit => edit.kind === 'replaceBlock' ? edit.replacement.filter(node => node.type === 'image') : []).map(node => node.type === 'image' ? <FeedGenerationImage key={node.attrs.id} workspaceId={c.workspaceId} fileId={node.attrs.fileId} alt={node.attrs.alt ?? ''} /> : null)}<p className="whitespace-pre-wrap text-sm">{text}</p><p className="text-xs text-muted-foreground">{candidate.rationale}</p>
        {stale && actionable ? <p className="text-sm">{t.stale}</p> : null}
        {actionable ? <div className="flex flex-wrap gap-2"><Button variant="default" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={disabled || stale} onClick={() => void c.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'accepted' }])}>{tc.accept}</Button><Button variant="destructive" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={disabled} onClick={() => void c.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'rejected' }])}>{tc.reject}</Button><Button variant="outline" size="sm" className="min-h-11 md:min-h-8 whitespace-normal" disabled={disabled || candidate.status === 'deferred'} onClick={() => void c.onCommand([{ kind: 'decide', suggestionId: candidate.id, outcome: 'deferred' }])}>{t.keepLater}</Button></div> : <p className="text-xs">{tc[candidate.status as 'accepted' | 'rejected'] ?? candidate.status}</p>}
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
export function FeedGenerationImage({ workspaceId, fileId, alt, className }: { workspaceId: string; fileId: string; alt: string; className?: string }) {
  const t = useT().feedGeneration; const [url, setUrl] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let disposed = false; let objectUrl: string | null = null; setUrl(null); setFailed(false);
    void fetchDocFileBlob(workspaceId, fileId).then(blob => { if (disposed) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [workspaceId, fileId]);
  return url ? <img src={url} alt={alt} className={className ?? 'max-h-96 max-w-full rounded-lg object-contain'} /> : <p role="status" className="min-h-11 text-sm">{failed ? t.imageUnavailable : t.loading}{alt ? `: ${alt}` : ''}</p>;
}
