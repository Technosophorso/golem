import {
  buildAliasInternalLink,
  buildCanonicalInternalLink,
  buildIdHandoffUrl,
  type InternalAliasKind,
} from "@use-brian/shared/desktop-links";
import { authFetch } from "@/lib/auth-fetch";
import { docPublicUrl } from "@/lib/doc-public-url";
import { publicRuntimeConfig } from "@/lib/runtime-public-config";
import { WORKSPACE_IDENTITY_REFRESH_EVENT } from "@/lib/workspace-identity-events";

const API_URL = publicRuntimeConfig().apiUrl || "http://localhost:4000";
const CACHE_PREFIX = "usebrian:internal-link:v1:";

export type InternalLinkCapabilities = Readonly<{
  pageLinkHandoffVersion?: 1;
  internalLinkAliasesVersion?: 1;
}>;

export type InternalLinkValue = Readonly<{
  workspaceId: string;
  pageId?: string;
  workspaceAlias: string;
  pageAlias?: string;
  sharePath: string;
  canonicalPath: string;
  url: string;
}>;

export class InternalLinkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly suggestion?: string,
  ) {
    super(message);
  }
}

let capabilitiesPromise: Promise<InternalLinkCapabilities> | null = null;

function runtimeCapabilities(): InternalLinkCapabilities {
  const config = publicRuntimeConfig();
  return {
    ...(config.pageLinkHandoffVersion === 1 ? { pageLinkHandoffVersion: 1 as const } : {}),
    ...(config.internalLinkAliasesVersion === 1 ? { internalLinkAliasesVersion: 1 as const } : {}),
  };
}

/** Discover once per page life; bundled desktop uses its target's persisted declaration. */
export function getInternalLinkCapabilities(): Promise<InternalLinkCapabilities> {
  if (capabilitiesPromise) return capabilitiesPromise;
  const configured = runtimeCapabilities();
  if (configured.pageLinkHandoffVersion === 1 || typeof window === "undefined" || window.location.protocol === "file:") {
    capabilitiesPromise = Promise.resolve(configured);
    return capabilitiesPromise;
  }
  capabilitiesPromise = fetch("/api/desktop-config", { cache: "no-store" })
    .then(async (response) => response.ok ? await response.json() as Record<string, unknown> : {})
    .then((body) => ({
      ...(body.pageLinkHandoffVersion === 1 ? { pageLinkHandoffVersion: 1 as const } : {}),
      ...(body.internalLinkAliasesVersion === 1 ? { internalLinkAliasesVersion: 1 as const } : {}),
    }))
    .catch(() => ({}));
  return capabilitiesPromise;
}

async function json<T>(path: string, init: RequestInit): Promise<T> {
  const response = await authFetch(`${API_URL}${path}`, init);
  const body = await response.json().catch(() => ({})) as { error?: string; suggestion?: string };
  if (!response.ok) {
    throw new InternalLinkApiError(body.error ?? "Internal link request failed", response.status, body.suggestion);
  }
  return body as T;
}

function cacheKey(appOrigin: string, workspaceId: string, pageId?: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(appOrigin)}:${workspaceId}:${pageId ?? "workspace"}`;
}

function readConfirmedAlias(appOrigin: string, workspaceId: string, pageId?: string): InternalLinkValue | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(appOrigin, workspaceId, pageId));
    if (!raw) return null;
    const value = JSON.parse(raw) as InternalLinkValue;
    if (value.workspaceId !== workspaceId || value.pageId !== pageId) return null;
    buildAliasInternalLink({
      appOrigin,
      workspaceAlias: value.workspaceAlias,
      pageAlias: value.pageAlias,
    });
    return value;
  } catch {
    return null;
  }
}

function rememberConfirmedAlias(appOrigin: string, value: InternalLinkValue): InternalLinkValue {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(cacheKey(appOrigin, value.workspaceId, value.pageId), JSON.stringify(value));
    } catch {
      // Storage is an offline optimization; the server remains authoritative.
    }
  }
  return value;
}

export async function ensureInternalLink(workspaceId: string, pageId?: string): Promise<InternalLinkValue> {
  const value = await json<InternalLinkValue>("/api/internal-links/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, ...(pageId ? { pageId } : {}) }),
  });
  const origin = docPublicUrl("/")?.replace(/\/$/, "") ?? new URL(value.url).origin;
  return rememberConfirmedAlias(origin, value);
}

export async function resolveInternalLink(workspaceAlias: string, pageAlias?: string): Promise<InternalLinkValue> {
  return json<InternalLinkValue>("/api/internal-links/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceAlias, ...(pageAlias ? { pageAlias } : {}) }),
  });
}

export async function renameInternalLinkAlias(input: {
  kind: InternalAliasKind;
  id: string;
  alias: string;
}): Promise<InternalLinkValue> {
  const path = input.kind === "workspace"
    ? `/api/internal-links/workspaces/${encodeURIComponent(input.id)}/alias`
    : `/api/internal-links/pages/${encodeURIComponent(input.id)}/alias`;
  const value = await json<InternalLinkValue>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias: input.alias }),
  });
  const origin = docPublicUrl("/")?.replace(/\/$/, "") ?? new URL(value.url).origin;
  rememberConfirmedAlias(origin, value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKSPACE_IDENTITY_REFRESH_EVENT, {
      detail: { workspaceId: value.workspaceId },
    }));
  }
  return value;
}

export async function checkInternalLinkAlias(input: {
  kind: InternalAliasKind;
  id: string;
  alias: string;
}): Promise<{ available: boolean; suggestion?: string }> {
  const scope = input.kind === "workspace" ? "workspaces" : "pages";
  return json(`/api/internal-links/${scope}/${encodeURIComponent(input.id)}/alias-availability?alias=${encodeURIComponent(input.alias)}`, {
    method: "GET",
  });
}

export async function authorizeStableInternalLink(input: {
  workspaceId: string;
  pageId?: string;
}): Promise<boolean> {
  const workspace = await authFetch(`${API_URL}/api/workspaces/${encodeURIComponent(input.workspaceId)}`);
  if (workspace.status === 401) throw new InternalLinkApiError("Authentication required", 401);
  if (!workspace.ok) return false;
  if (!input.pageId) return true;
  const page = await authFetch(`${API_URL}/api/views/${encodeURIComponent(input.pageId)}`);
  if (page.status === 401) throw new InternalLinkApiError("Authentication required", 401);
  return page.ok;
}

export async function bestInternalShareLink(input: {
  workspaceId: string;
  pageId?: string;
  blockId?: string;
}): Promise<{ url: string; aliases?: InternalLinkValue; capabilities: InternalLinkCapabilities }> {
  const canonical = docPublicUrl(`/w/${encodeURIComponent(input.workspaceId)}/p${input.pageId ? `/${encodeURIComponent(input.pageId)}` : ""}${input.blockId ? `#b-${encodeURIComponent(input.blockId)}` : ""}`);
  if (!canonical) throw new Error("No shareable app origin");
  const capabilities = await getInternalLinkCapabilities();
  if (capabilities.internalLinkAliasesVersion === 1) {
    let aliases: InternalLinkValue | null = null;
    try {
      aliases = await ensureInternalLink(input.workspaceId, input.pageId);
    } catch {
      aliases = readConfirmedAlias(new URL(canonical).origin, input.workspaceId, input.pageId);
    }
    if (aliases) {
      return {
        url: buildAliasInternalLink({
          appOrigin: new URL(canonical).origin,
          workspaceAlias: aliases.workspaceAlias,
          pageAlias: aliases.pageAlias,
          blockId: input.blockId,
        }),
        aliases,
        capabilities,
      };
    }
  }
  return {
    url: capabilities.pageLinkHandoffVersion === 1 ? buildIdHandoffUrl(canonical) : canonical,
    capabilities,
  };
}

/** Test and hot-reload helper. */
export function resetInternalLinkCapabilityCache(): void {
  capabilitiesPromise = null;
}
