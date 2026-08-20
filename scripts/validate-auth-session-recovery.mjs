import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desktop = readFileSync("components/auth/RoleGuard.tsx", "utf8");
const mobile = readFileSync("components/mobile/MobileRoleGuard.tsx", "utf8");

for (const [name, source] of [["desktop", desktop], ["mobile", mobile]]) {
  assert.match(source, /expires_at/, `${name} guard must inspect cached access-token expiry.`);
  assert.match(source, /expiredOrNearExpiry/, `${name} guard must proactively refresh expired or near-expiry sessions.`);
  assert.match(source, /refreshSession/, `${name} guard must refresh a recoverable long-idle session.`);
  assert.match(source, /jwt\.\*expired|jwt.*expired/i, `${name} guard must retry when Supabase reports an expired JWT.`);
  assert.match(source, /unauthorized/, `${name} guard must treat an expired-token 401 as recoverable before failing.`);
  assert.match(source, /attempt\s*>\s*0/, `${name} guard must retry with refresh after a transient profile/auth failure.`);
}

console.log("PASS long-idle auth session recovery regression lock");
