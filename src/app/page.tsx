import SimulatorLab from "@/components/SimulatorLab";
import { SCENARIOS, normalizeSeed } from "@/lib/simulation.js";

interface PageProps {
  searchParams: Promise<{ seed?: string; scenario?: string }>;
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const seed = normalizeSeed(params.seed || "QUEUEGLASS-7");
  const requestedScenario = params.scenario || "nominal";
  const scenario = Object.hasOwn(SCENARIOS, requestedScenario)
    ? (requestedScenario as keyof typeof SCENARIOS)
    : "nominal";
  return <SimulatorLab initialSeed={seed} initialScenario={scenario} />;
}
