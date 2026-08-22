import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertBrowserOperatorSafety } from "./safety";

export type SupabaseAny = ReturnType<typeof createClient> & any;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function requireOperatorEnvironment() {
  const safety = assertBrowserOperatorSafety();
  expect(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();
  expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY is required").toBeTruthy();
  return safety;
}

export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as SupabaseAny;
}

export function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as SupabaseAny;
}

export async function signInAccount(email: string, password: string) {
  const client = anonClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  expect(signed.error, signed.error?.message).toBeNull();
  const token = signed.data.session?.access_token || "";
  expect(token).toBeTruthy();
  return { client, token, session: signed.data.session };
}

export async function signInBrowser(page: Page, email: string, password: string) {
  const signed = await signInAccount(email, password);
  const session = signed.session;
  expect(session, "Supabase session is required for browser auth").toBeTruthy();

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  await page.evaluate(({ key, value }) => {
    window.localStorage.setItem("damasio_keep_connected", "true");
    window.localStorage.setItem(key, JSON.stringify(value));
    window.sessionStorage.removeItem(key);
  }, { key: storageKey, value: session });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/checking your account/i)).toHaveCount(0, { timeout: 30_000 });
  expect(page.url()).not.toMatch(/\/login(?:\?|$)/);
}

export async function browserAuthRequest<T>(page: Page, path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  const token = await accessTokenFor(page);
  const response = await page.request.fetch(path, {
    method: init?.method || "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: init?.body,
    timeout: init?.timeoutMs || 120_000,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  expect(response.ok(), `${path}: HTTP ${response.status()} ${text}`).toBeTruthy();
  return payload as T;
}

async function accessTokenFor(page: Page) {
  const storage = await page.context().storageState();
  const origin = storage.origins.find(item => item.localStorage.some(entry => entry.name.startsWith("sb-") && entry.name.endsWith("-auth-token")));
  const authEntry = origin?.localStorage.find(entry => entry.name.startsWith("sb-") && entry.name.endsWith("-auth-token"));
  expect(authEntry?.value, "Supabase auth token must exist in the browser session").toBeTruthy();
  const stored = JSON.parse(authEntry?.value || "{}");
  const token = stored?.access_token || stored?.currentSession?.access_token;
  expect(token, "Supabase access token must exist").toBeTruthy();
  return String(token);
}

export function torontoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextWeekday(target: number, minimumOffset = 1) {
  const today = new Date(`${torontoDate()}T12:00:00Z`);
  const current = today.getUTCDay();
  let delta = (target - current + 7) % 7;
  if (delta < minimumOffset) delta += 7;
  return torontoDate(delta);
}
