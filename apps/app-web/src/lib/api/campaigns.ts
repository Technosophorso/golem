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
  approvedRevision: number | null;
  publicationReference: string | null;
  publishedAt: string | null;
};

export type CampaignEmailMetadata = {
  subject: string;
  preheader?: string;
  senderId: string;
  replyTo?: string;
  audience: { segmentId: string; segmentVersion: number };
  purposeKey: string;
  personalization: Array<{ field: "first_name" | "last_name" | "display_name" | "company_name"; required: boolean; fallback?: string }>;
  tracking: { links: boolean; website: boolean };
};

export type CampaignEmailDraft = {
  campaignId: string; placementId: string; sessionId: string; assistantId: string;
  revision: number; metadata: CampaignEmailMetadata | null;
  approval: { dispatchId: string; revision: number; state: string; current: boolean } | null;
};

export type CampaignEmailCatalog = {
  senders: Array<{ id: string; label: string; address: string | null; provider: string; health: string; broadcastCapable: boolean }>;
  segments: Array<{ id: string; name: string; version: number }>;
  purposes: Array<{ purposeKey: string; label: string; requiresConsent: boolean }>;
};

export type CampaignAudiencePreview = {
  state: "available"; revision: number;
  segment: { id: string; version: number; name: string };
  eligible: Array<{ contactId: string; address: string; personalization: Record<string, string>; eligibility: Record<string, unknown> }>;
  excluded: Array<{ contactId: string; address?: string | null; verdict?: string; reasons: string[]; missing?: string[] }>;
  counts: { matched: number; eligible: number; excluded: number };
};

export type CampaignEmailProjection = { subject: string; preheader: string | null; text: string; html: string };

export type CampaignDispatch = {
  dispatch: { id: string; campaignId: string; placementId: string; approvedRevision: number; state: string; scheduledAt: string; approvedAt: string; startedAt: string | null; completedAt: string | null };
  counts: { total: number; accepted: number; rejected: number; suppressed: number; pending: number; uncertain: number; cancelled: number };
  metrics: { smtpAccepted: "available"; delivered: "unavailable"; opened: "unsupported"; replies: "unavailable"; bounces: "unavailable"; complaints: "unavailable" };
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
  emailAccepted?: number;
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

function emailPath(campaignId: string, placementId: string, suffix = ""): string {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/placements/${encodeURIComponent(placementId)}/email${suffix}`;
}

export async function getCampaignEmailDraft(workspaceId: string, campaignId: string, placementId: string): Promise<CampaignEmailDraft> {
  const query = new URLSearchParams({ workspaceId });
  return (await campaignJson<{ draft: CampaignEmailDraft }>(`${emailPath(campaignId, placementId)}?${query}`)).draft;
}

export async function getCampaignEmailCatalog(workspaceId: string): Promise<CampaignEmailCatalog> {
  const query = new URLSearchParams({ workspaceId });
  return campaignJson<CampaignEmailCatalog>(`/api/campaigns/email/catalog?${query}`);
}

export async function updateCampaignEmail(input: { workspaceId: string; campaignId: string; placementId: string; mutationId: string; expectedRevision: number; metadata: CampaignEmailMetadata }): Promise<{ draft: CampaignEmailDraft }> {
  return campaignJson(emailPath(input.campaignId, input.placementId, "/commands"), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

export async function previewCampaignEmail(input: { workspaceId: string; campaignId: string; placementId: string; revision?: number; values?: Record<string, string> }): Promise<{ revision: number; projection: CampaignEmailProjection }> {
  return campaignJson(emailPath(input.campaignId, input.placementId, "/preview"), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

export async function previewCampaignAudience(workspaceId: string, campaignId: string, placementId: string): Promise<CampaignAudiencePreview> {
  return campaignJson(emailPath(campaignId, placementId, "/audience-preview"), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }),
  });
}

export async function sendCampaignTest(workspaceId: string, campaignId: string, placementId: string, contactId: string): Promise<{ test: true; revision: number }> {
  return campaignJson(emailPath(campaignId, placementId, "/test"), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, contactId, deliveryId: crypto.randomUUID() }),
  });
}

export async function prepareCampaignDispatch(input: { workspaceId: string; campaignId: string; placementId: string; approvedRevision: number; metadata: CampaignEmailMetadata; scheduledAt: string; recipients: CampaignAudiencePreview["eligible"] }): Promise<{ dispatch: { dispatchId: string; state: string; scheduledAt: string; recipients: number } }> {
  return runCampaignCommand({ workspaceId: input.workspaceId, idempotencyKey: crypto.randomUUID(), command: {
    kind: "prepare_dispatch", campaignId: input.campaignId, placementId: input.placementId,
    approvedRevision: input.approvedRevision, metadata: input.metadata, scheduledAt: input.scheduledAt,
    recipients: input.recipients,
  } });
}

export async function scheduleCampaignDispatch(workspaceId: string, dispatchId: string, scheduledAt: string): Promise<void> {
  await runCampaignCommand({ workspaceId, idempotencyKey: crypto.randomUUID(), command: { kind: "schedule_dispatch", dispatchId, scheduledAt } });
}

export async function pauseCampaignDispatch(workspaceId: string, dispatchId: string): Promise<void> {
  await runCampaignCommand({ workspaceId, idempotencyKey: crypto.randomUUID(), command: { kind: "pause_dispatch", dispatchId } });
}

export async function cancelCampaignDispatch(workspaceId: string, dispatchId: string): Promise<void> {
  await runCampaignCommand({ workspaceId, idempotencyKey: crypto.randomUUID(), command: { kind: "cancel_dispatch", dispatchId } });
}

export async function getCampaignDispatch(workspaceId: string, campaignId: string, dispatchId: string): Promise<CampaignDispatch> {
  const query = new URLSearchParams({ workspaceId });
  return campaignJson(`/api/campaigns/${encodeURIComponent(campaignId)}/dispatches/${encodeURIComponent(dispatchId)}?${query}`);
}
