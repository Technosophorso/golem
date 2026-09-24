"use client";
/** Website content collections: draft → human preview → immutable publication. [COMP:app-web/site-content] */
import { useState } from "react";
import { getSiteContentDraft, listWebsiteMedia, publishSiteContent, saveSiteContentDraft, type MembershipLocale, type SiteContentCollection, type SiteContentDocument } from "@/lib/api/association";
import { useT } from "@/lib/i18n/client";
import { useCachedResource } from "@/lib/surface-cache";
import { associationPageCacheKey } from "@/lib/surface-prefetch";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { AssociationChoice as Choice, AssociationListState, useAssociationAction } from "../operator-controls";
import { useAssociationModule } from "../module-controls";
import { InlineNotice, PageHeader } from "../ui";
import { blankDocument, COLLECTION_FIELDS } from "./descriptors";
import { DocumentOutline, FieldsEditor } from "./document-editor";

const LOCALES = ["en", "zh-Hant", "zh-Hans"] as const;
const LOCALE_LABELS = { en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文" };

export function SiteContentPanel({ workspaceId, collection }: { workspaceId: string; collection: SiteContentCollection }) {
  const t = useT().associationPage, c = t.content;
  const module = useAssociationModule(workspaceId), manage = !!module.data?.canManage, enabled = module.data?.module.state === "enabled";
  const read = useCachedResource(manage ? associationPageCacheKey(workspaceId, `site-content:${collection}`) : null, () => getSiteContentDraft(workspaceId, collection));
  const media = useCachedResource(manage ? associationPageCacheKey(workspaceId, "website-media") : null, () => listWebsiteMedia(workspaceId));
  const action = useAssociationAction(workspaceId);
  const [editing, setEditing] = useState<{ version: number; document: SiteContentDocument } | null>(null);
  const [locale, setLocale] = useState<MembershipLocale>("en");
  const [preview, setPreview] = useState(false);
  const fields = COLLECTION_FIELDS[collection];
  const title = (c.collections as Record<SiteContentCollection, { title: string; help: string }>)[collection];
  const doc = editing?.document ?? read.data?.document ?? null;

  async function save() {
    if (!editing) return;
    const current = editing;
    if (await action.run(c.save, () => saveSiteContentDraft(workspaceId, collection, current.version, current.document), false)) {
      setEditing(null); setPreview(false); await read.refresh();
    }
  }
  async function publish() {
    if (!read.data || editing || !preview) return;
    if (await action.run(c.publish, () => publishSiteContent(workspaceId, collection, read.data!.version), { description: c.review })) {
      setPreview(false); await read.refresh();
    }
  }
  async function cancel() {
    if (await confirmDialog({ title: t.ux.cancelEdit, description: t.ux.cancelHelp, confirmLabel: t.cancel, cancelLabel: t.ux.keepEditing })) setEditing(null);
  }

  return <section className="space-y-5">
    <PageHeader level={2} title={title.title} description={title.help}/>
    {!manage ? <InlineNotice tone="neutral">{t.manage.canConfigure}</InlineNotice> : <AssociationListState {...read}>
      {read.data && <>
        <p className="text-sm">{c.published}: {read.data.publishedRevision || c.none}</p>
        <div className="flex flex-wrap gap-3" role="status">{read.data.readers.map(site => <p key={site} className="text-sm">{site.toUpperCase()}: {read.data!.publishedRevision > 0 && read.data!.observations[site]?.revision === read.data!.publishedRevision ? c.observed : c.pending}</p>)}</div>
        {!doc && <InlineNotice tone="neutral">{c.empty}</InlineNotice>}
        <div className="flex flex-wrap gap-2">
          {!editing && <Button className="min-h-11" disabled={!enabled} onClick={() => { setEditing({ version: read.data!.version, document: structuredClone(doc ?? blankDocument(collection)) }); setPreview(false); }}>{doc ? c.edit : c.create}</Button>}
          {editing && <><Button className="min-h-11" disabled={action.pending} onClick={() => void save()}>{c.save}</Button><Button className="min-h-11" variant="outline" onClick={() => void cancel()}>{t.cancel}</Button></>}
          {!editing && doc && <Button className="min-h-11" variant="outline" onClick={() => setPreview(!preview)}>{c.preview}</Button>}
          {preview && !editing && <Button className="min-h-11" disabled={!enabled || action.pending || read.data.issues.length > 0 || read.data.version === read.data.publishedRevision} onClick={() => void publish()}>{c.publish}</Button>}
        </div>
        {action.feedback}
        {read.data.issues.length > 0 && <ul role="alert" className="list-inside list-disc text-sm text-destructive">{read.data.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {doc && <div className="max-w-xs"><Choice label={c.language} value={locale} values={LOCALES} labels={LOCALE_LABELS} onChange={value => setLocale(value as MembershipLocale)}/></div>}
        {editing && <FieldsEditor fields={fields} value={editing.document} context={{ locale, media: media.data ?? [], workspaceId, disabled: action.pending }}
          onChange={document => setEditing(old => old ? { ...old, document } : old)}/>}
        {preview && !editing && doc && <div className="grid min-w-0 gap-4 lg:grid-cols-2">{([[c.before, read.data.published], [c.after, doc]] as const).map(([heading, value]) =>
          <div key={heading} className="min-w-0 rounded-xl border p-4"><h3 className="mb-3 font-semibold">{heading}</h3><DocumentOutline fields={fields} value={value} locale={locale}/></div>)}</div>}
        {!editing && !preview && doc && <div className="rounded-xl border p-4"><DocumentOutline fields={fields} value={doc} locale={locale}/></div>}
      </>}
    </AssociationListState>}
  </section>;
}
