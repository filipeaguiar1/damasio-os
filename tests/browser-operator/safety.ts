import { expect } from "@playwright/test";

export function assertBrowserOperatorSafety() {
  const baseURL = process.env.QA_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  const namespace = process.env.QA_NAMESPACE || "";
  const allowMutations = process.env.QA_ALLOW_MUTATIONS === "1";

  expect(baseURL, "QA_BASE_URL/NEXT_PUBLIC_APP_URL is required").toBeTruthy();
  expect(namespace, "QA_NAMESPACE is required").toMatch(/^qa_[a-z0-9_-]+$/i);
  expect(allowMutations, "QA_ALLOW_MUTATIONS=1 is required for browser operator writes").toBe(true);

  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  expect(stripeKey.startsWith("sk_live_"), "Browser Operator QA refuses live Stripe credentials").toBe(false);

  return { baseURL, namespace };
}
