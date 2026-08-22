"use client";

import { useEffect, useRef } from "react";
import { QuoteWizard } from "./QuoteWizard";

export function QuoteWizardConversion() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let redirected = false;

    const redirectOnSuccess = () => {
      if (redirected) return;

      const result = root.querySelector(".quote-result");
      const stateLabel = result?.querySelector("small")?.textContent?.trim();
      if (stateLabel !== "Request received") return;

      redirected = true;
      const reference = result?.querySelector(".quote-price")?.textContent?.trim();
      const query = reference ? `?reference=${encodeURIComponent(reference)}` : "";
      window.location.assign(`/quote-received${query}`);
    };

    const observer = new MutationObserver(redirectOnSuccess);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    redirectOnSuccess();

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef}>
      <QuoteWizard />
    </div>
  );
}
