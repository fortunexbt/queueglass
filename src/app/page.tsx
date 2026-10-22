import { readFile } from "node:fs/promises";
import path from "node:path";

import SimulatorLab from "@/components/SimulatorLab";
import { EXAMPLE_FILE, exampleSetup } from "@/lib/line.js";

// Read at build time: the page is static, and the worked example ships inside it.
export default async function Home() {
  const csv = await readFile(path.join(process.cwd(), "data", EXAMPLE_FILE), "utf8");
  return <SimulatorLab example={exampleSetup(csv)} />;
}
