import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const skip = new Set([".git", ".next", "node_modules", "output", "docs"]);
const patterns = [
  new RegExp(["AKIA", "[0-9A-Z]{16}"].join("")),
  new RegExp(["gh", "[pousr]_[A-Za-z0-9_]{20,}"].join("")),
  new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join("")),
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i,
];

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name === "package-lock.json" || entry.name === "secret-scan.mjs") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(target)));
    else if (/\.(?:md|json|js|mjs|ts|tsx|css|yml|yaml|txt)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const files = await collect(".");
const failures = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const pattern of patterns) if (pattern.test(text)) failures.push(`${file}: likely secret pattern ${pattern}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed across ${files.length} text files.`);
}
