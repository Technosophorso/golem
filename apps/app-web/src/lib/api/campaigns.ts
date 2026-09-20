import { publicRuntimeConfig } from "@/lib/runtime-public-config";
import { authFetch } from "@/lib/auth-fetch";

const API_URL = publicRuntimeConfig().apiUrl ?? "http://localhost:4000";

export type CampaignSummary = {
  id: string;
  name: string;
  objective: string;
  state: "draft" | "active" | "completed" | "archived";
  timezone: string;
  primaryConversion: "signup_completed" | "enquiry_submitted" | "activation_completed";
  version: number;
  placements?: CampaignPlacement[];
  links?: CampaignLink[];
};

export type CampaignPlacement = {
  id: string;
  sessionId: string;
  channel: "instagram" | "threads" | "twitter" | "xhs" | "linkedin" | "email";
  placementKind: "body" | "first_comment" | "profile" | "email_body";
  placementKey: string;
  publicationReference: string | null;
  publishedAt: string | null;
};

export type CampaignResults = {
  state: "not_installed" | "disabled" | "unsupported" | "delayed" | "failed" | "empty" | "available";
  reason?: string;
  rawRedirectRequests?: number;
  filteredRedirectRequests?: number;
  pageViews?: number;
  sessions?: number | null;
  visitors?: number | null;
  verifiedConversions?: number;
  denominator?: "sessions" | "unavailable";
  limitations?: string[];
};

export type CampaignSubjectAttribution = {
  state: "empty" | "available";
  limitation: string;
  conversions: Array<{
    id: string; conversionKind: string; occurredAt: string; conversionEvidence: string;
    campaignId: string | null; campaignName: string | null; channel: string | null;
    placementKey: string | null; destination: string | null; attribution: Record<string, unknown>;
  }>;
};

type CampaignLink = {
  id: string;
  placementId: string;
  publicId: string;
  destination: string;
  enabled: boolean;
  utm: Record<string, string>;
};

async function campaignJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API_URL}${path}`, init);
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? `Campaign API ${response.status}`);
  return body;
}

export async function listCampaigns(workspaceId: string): Promise<CampaignSummary[]> {
  const query = new URLSearchParams({ workspaceId });
  const body = await campaignJson<{ campaigns: CampaignSummary[] }>(`/api/campaigns?${query}`);
  return body.campaigns;
}

export async function getCampaign(workspaceId: string, campaignId: string): Promise<CampaignSummary> {
  const query = new URLSearchParams({ workspaceId });
  const body = await campaignJson<{ campaign: CampaignSummary }>(
    `/api/campaigns/${encodeURIComponent(campaignId)}?${query}`,
  );
  return body.campaign;
}

export async function runCampaignCommand<T>(input: {
  workspaceId: string;
  idempotencyKey: string;
  command: Record<string, unknown> & { kind: string };
}): Promise<T> {
  const body = await campaignJson<{ result: T }>("/api/campaigns/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.result;
}

export async function getCampaignResults(workspaceId: string, campaignId: string): Promise<CampaignResults> {
  const query = new URLSearchParams({ workspaceId });
  return campaignJson<CampaignResults>(`/api/campaigns/${encodeURIComponent(campaignId)}/results?${query}`);
}

export async function getCampaignSubjectAttribution(workspaceId: string, contactId: string): Promise<CampaignSubjectAttribution> {
  const query = new URLSearchParams({ workspaceId });
  return campaignJson<CampaignSubjectAttribution>(`/api/campaigns/contacts/${encodeURIComponent(contactId)}/attribution?${query}`);
}
