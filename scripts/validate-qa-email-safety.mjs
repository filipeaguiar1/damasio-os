import fs from "node:fs";
import path from "node:path";

const roots = ["tests"];
const forbidden = [
  "inviteUserByEmail(",
  ".auth.signUp(",
  ".auth.signInWithOtp(",
  ".auth.resetPasswordForEmail(",
  ".auth.resend(",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /(?:full-ecosystem|operational-simulator).*\.spec\.ts$/i.test(entry.name) ? [full] : [];
  });
}

const files = roots.flatMap(walk);
const failures = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const token of forbidden) {
    if (text.includes(token)) failures.push(`${file}: forbidden transactional-email call ${token}`);
  }

  let cursor = 0;
  const marker = "auth.admin.createUser({";
  while ((cursor = text.indexOf(marker, cursor)) !== -1) {
    const end = text.indexOf("});", cursor);
    const block = end === -1 ? text.slice(cursor) : text.slice(cursor, end + 3);
    if (!/email_confirm\s*:\s*true/.test(block)) {
      failures.push(`${file}: QA auth.admin.createUser must set email_confirm: true`);
    }
    cursor += marker.length;
  }
}

const masterCompanyRoute = fs.readFileSync("app/api/master/companies/route.ts", "utf8");
const fullEcosystemTest = fs.readFileSync("tests/full-ecosystem.spec.ts", "utf8");
if (!masterCompanyRoute.includes('x-damasio-qa-no-email') || !masterCompanyRoute.includes('127\\.0\\.0\\.1')) {
  failures.push("Master company endpoint is missing the localhost-only QA no-email guard");
}
if (!fullEcosystemTest.includes('"x-damasio-qa-no-email": "1"')) {
  failures.push("Full Ecosystem test is missing the explicit QA no-email header");
}

if (failures.length) {
  console.error("QA email safety check failed:\n" + failures.map(item => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`PASS QA email safety (${files.length} E2E files checked; no transactional email paths).`);
