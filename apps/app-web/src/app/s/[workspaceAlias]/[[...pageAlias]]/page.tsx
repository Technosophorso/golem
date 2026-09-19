import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidInternalAlias } from "@use-brian/shared/desktop-links";
import { InternalLinkHandoff } from "@/components/internal-link-handoff";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function AliasHandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceAlias: string; pageAlias?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceAlias, pageAlias = [] } = await params;
  const search = await searchParams;
  const keys = Object.keys(search);
  if (
    pageAlias.length > 1 ||
    !isValidInternalAlias(workspaceAlias, "workspace") ||
    (pageAlias[0] !== undefined && !isValidInternalAlias(pageAlias[0], "page")) ||
    keys.some((key) => key !== "web" && key !== "block") ||
    (search.web !== undefined && search.web !== "1") ||
    Array.isArray(search.block)
  ) notFound();
  return <InternalLinkHandoff input={{
    kind: "aliases",
    workspaceAlias,
    ...(pageAlias[0] ? { pageAlias: pageAlias[0] } : {}),
  }} />;
}
