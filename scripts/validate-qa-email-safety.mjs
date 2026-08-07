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

if (failures.length) {
  console.error("QA email safety check failed:\n" + failures.map(item => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`PASS QA email safety (${files.length} E2E files checked; no transactional email paths).`);
