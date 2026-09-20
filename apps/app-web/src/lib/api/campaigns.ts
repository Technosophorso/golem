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
