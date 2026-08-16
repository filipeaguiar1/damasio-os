import type { Page } from "@playwright/test";

type AuthRequestInit = {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
};

async function accessTokenFor(page: Page, baseURL: string) {
  const storage = await page.context().storageState();
  const origin = storage.origins.find(item => item.origin === baseURL)
    || storage.origins.find(item => item.localStorage.some(entry => entry.name.startsWith("sb-") && entry.name.endsWith("-auth-token")));
  const authEntry = origin?.localStorage.find(entry => entry.name.startsWith("sb-") && entry.name.endsWith("-auth-token"));
  if (!authEntry) throw new Error("Supabase browser session was not found.");

  const stored = JSON.parse(authEntry.value || "null");
  const accessToken = stored?.access_token || stored?.currentSession?.access_token;
  if (!accessToken) throw new Error("Supabase access token was not found.");
  return String(accessToken);
}

export async function stableAuthRequest<T>(
  page: Page,
  baseURL: string,
  path: string,
  init?: AuthRequestInit,
): Promise<T> {
  let lastError = "Request failed.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const accessToken = await accessTokenFor(page, baseURL);
      const response = await page.request.fetch(`${baseURL}${path}`, {
        method: init?.method || "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        data: init?.body,
        timeout: init?.timeoutMs ?? 90_000,
        failOnStatusCode: false,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok()) {
        const message = result.error || `${response.status()} ${path}`;
        throw new Error(`HTTP_${response.status()}:${message}`);
      }
      return result as T;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const retryable = /fetch failed|failed to fetch|network|abort|timed out|timeout|econnreset/i.test(lastError)
        || /HTTP_(400|401):Bad Request/i.test(lastError);
      if (attempt === 2 || !retryable) {
        throw new Error(lastError.replace(/^.*HTTP_\d+:/, ""));
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }

  throw new Error(lastError.replace(/^.*HTTP_\d+:/, ""));
}
