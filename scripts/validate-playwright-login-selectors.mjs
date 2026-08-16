import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const testsRoot = path.join(repoRoot, "tests");

function collectSpecFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSpecFiles(fullPath));
    else if (entry.isFile() && /\.spec\.tsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const specs = collectSpecFiles(testsRoot);
const ambiguousEmailLabel = /getByLabel\(\s*["']Email["']\s*\)/;
const offenders = [];

for (const spec of specs) {
  const source = fs.readFileSync(spec, "utf8");
  if (ambiguousEmailLabel.test(source)) {
    offenders.push(path.relative(repoRoot, spec).replaceAll("\\", "/"));
  }
}

if (offenders.length) {
  throw new Error(
    `Ambiguous Playwright Email locator found in: ${offenders.join(", ")}. ` +
    'Use getByRole("textbox", { name: "Email" }) so the Remember email checkbox cannot match.',
  );
}

console.log(`Playwright login selector contract: PASS (${specs.length} specs)`);
