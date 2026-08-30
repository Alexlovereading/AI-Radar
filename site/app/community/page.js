import { loadCommunitySignals } from "../../lib/community.mjs";
import CommunityRadar from "../../components/CommunityRadar.jsx";

export const metadata = {
  title: "社区热点 — AI 新词雷达",
  description: "只展示北京时间当天、评分达标的社区讨论与趋势项目。",
};

export default async function CommunityPage() {
  const data = await loadCommunitySignals();
  return <CommunityRadar data={data} />;
}
