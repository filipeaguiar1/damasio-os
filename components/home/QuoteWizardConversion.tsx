"use client";

import { useEffect, useRef } from "react";
import type { ServiceKey } from "@/lib/pricing";
import { serviceLabels } from "@/lib/pricing";
import { QuoteWizard } from "./QuoteWizard";

const serviceKeys: ServiceKey[] = ["weekly_lawn", "biweekly_lawn", "one_time_lawn", "spring_cleanup", "fall_cleanup", "snow_removal", "extra_service"];

function readRequestedService(): ServiceKey | null {
  const searchService = new URLSearchParams(window.location.search).get("service");
  if (searchService && serviceKeys.includes(searchService as ServiceKey)) return searchService as ServiceKey;

  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  if (queryIndex >= 0) {
    const hashService = new URLSearchParams(hash.slice(queryIndex + 1)).get("service");
    if (hashService && serviceKeys.includes(hashService as ServiceKey)) return hashService as ServiceKey;
    const legacyValue = hash.slice(queryIndex + 1);
    if (serviceKeys.includes(legacyValue as ServiceKey)) return legacyValue as ServiceKey;
  }

  return null;
}

export function QuoteWizardConversion() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selectRequestedService = () => {
      const root = rootRef.current;
      const requestedService = readRequestedService();
      if (!root || !requestedService) return;

      const label = serviceLabels[requestedService];
      const serviceButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".option-grid button")).find(button => button.textContent?.includes(label));
      serviceButton?.click();
      document.getElementById("quote")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    selectRequestedService();
    window.addEventListener("hashchange", selectRequestedService);
    window.addEventListener("damasio:quote-service-change", selectRequestedService);

    return () => {
      window.removeEventListener("hashchange", selectRequestedService);
      window.removeEventListener("damasio:quote-service-change", selectRequestedService);
    };
  }, []);

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
