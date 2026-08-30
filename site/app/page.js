import { loadAllEntities } from "../lib/entities.mjs";
import RadarDashboard from "../components/RadarDashboard.jsx";

export default async function HomePage() {
  const entities = await loadAllEntities();

  return <RadarDashboard entities={entities} />;
}
