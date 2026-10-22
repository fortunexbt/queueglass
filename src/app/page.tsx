import SimulatorLab from "@/components/SimulatorLab";
import {
  normalizeScenario,
  normalizeSeed,
  normalizeSettings,
} from "@/lib/simulation.js";

interface PageProps {
  searchParams: Promise<{
    seed?: string;
    scenario?: string;
    traffic?: string;
    caps?: string;
  }>;
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const scenario = normalizeScenario(params.scenario ?? "cascade");
  const settings = normalizeSettings(scenario, {
    traffic: params.traffic === undefined ? undefined : Number(params.traffic),
    capacities: params.caps?.split("-").map(Number),
  });
  return (
    <SimulatorLab
      initialSeed={normalizeSeed(params.seed || "QUEUEGLASS-7")}
      initialScenario={scenario}
      initialSettings={settings}
    />
  );
}
