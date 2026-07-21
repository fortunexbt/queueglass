import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "tests", ".github", "README.md", "CONTRIBUTING.md", "CHANGELOG.md", "package.json"];
const forbidden = [
  /colossus/i,
  /customer/i,
  /integration/i,
  /financial/i,
  /47[,.]?382/i,
  /80\.3\s*%/i,
  /675\s*K/i,
  /2\.4\s*M/i,
  /99\.97\s*%/i,
  /page\s+is\s+the\s+agent/i,
  /live telemetry/i,
  /real[- ]time (?:agent|coordination|intelligence|system)/i,
  /operational savings/i,
  /pipeline value/i,
  /FTE (?:replaced|roles)/i,
  /LinkedIn|Slack|Telegram|WhatsApp|Discord|Zoom|Pinecone|Monday\.com/i,
  /GPT-4|Claude Code|Gemini 2/i,
];

async function collect(target) {
  const stat = await import("node:fs/promises").then(({ stat }) => stat(target));
  if (stat.isFile()) return [target];
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => collect(path.join(target, entry.name))));
  return nested.flat();
}

const files = (await Promise.all(roots.map(collect)))
  .flat()
  .filter((file) => /\.(?:json|md|js|jsx|ts|tsx|yaml|yml)$/.test(file));
const failures = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) failures.push(`${file}: forbidden claim pattern ${pattern}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Claim scan passed across ${files.length} public source/document files.`);
}
