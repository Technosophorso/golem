import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InternalLinkHandoff } from "@/components/internal-link-handoff";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function IdHandoffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const keys = Object.keys(search);
  if (
    typeof search.path !== "string" ||
    keys.some((key) => key !== "path" && key !== "web" && key !== "block") ||
    (search.web !== undefined && search.web !== "1") ||
    Array.isArray(search.block)
  ) notFound();
  return <InternalLinkHandoff input={{ kind: "ids", path: search.path }} />;
}
