"use client";
/** Settings → Website content: the media library, programmes and every content collection. [COMP:app-web/site-content] */
import { useState } from "react";
import { SITE_CONTENT_COLLECTIONS, type SiteContentCollection } from "@/lib/api/association";
import { useT } from "@/lib/i18n/client";
import { ProgrammePublishingPanel } from "./programme-publishing";
import { SiteContentPanel } from "./site-content/site-content-panel";
import { WebsiteMediaPanel } from "./website-media";
import { Segmented } from "./ui";

type Section = "media" | "programmes" | SiteContentCollection;

export function WebsiteContentPanel({ workspaceId }: { workspaceId: string }) {
  const c = useT().associationPage.content;
  const [section, setSection] = useState<Section>("media");
  const titles = c.collections as Record<SiteContentCollection, { title: string }>;
  const options: { value: Section; label: string }[] = [
    { value: "media", label: c.sections.media }, { value: "programmes", label: c.sections.programmes },
    ...SITE_CONTENT_COLLECTIONS.map(collection => ({ value: collection as Section, label: titles[collection].title })),
  ];
  return <div className="space-y-6">
    <Segmented label={c.sections.label} value={section} options={options} onChange={setSection} className="flex-wrap"/>
    {section === "media" ? <WebsiteMediaPanel workspaceId={workspaceId}/>
      : section === "programmes" ? <ProgrammePublishingPanel workspaceId={workspaceId}/>
      : <SiteContentPanel key={section} workspaceId={workspaceId} collection={section}/>}
  </div>;
}
