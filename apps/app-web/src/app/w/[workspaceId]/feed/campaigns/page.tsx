import { FeedCampaigns } from "@/components/feed/feed-campaigns";

export default async function FeedCampaignsPage(props: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await props.params;
  return <FeedCampaigns workspaceId={workspaceId} />;
}
