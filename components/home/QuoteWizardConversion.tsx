"use client";

import { useEffect, useRef } from "react";
import type { ServiceKey } from "@/lib/pricing";
import { serviceLabels } from "@/lib/pricing";
import { QuoteWizard } from "./QuoteWizard";

const serviceKeys: ServiceKey[] = ["weekly_lawn", "biweekly_lawn", "one_time_lawn", "spring_cleanup", "fall_cleanup", "snow_removal", "extra_service", "year_care"];
const lawnServiceKeys: ServiceKey[] = ["weekly_lawn", "biweekly_lawn", "one_time_lawn"];

const lawnFrequencyLabels: Record<string, string> = {
  weekly_lawn: "Weekly",
  biweekly_lawn: "Biweekly",
  one_time_lawn: "One-time",
};

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
    const root = rootRef.current;
    if (!root) return;

    let lawnPickerExpanded = false;

    const findOriginalButton = (service: ServiceKey) => {
      const known = root.querySelector<HTMLButtonElement>(`button[data-lawn-source="${service}"]`);
      if (known) return known;
      const label = serviceLabels[service];
      return Array.from(root.querySelectorAll<HTMLButtonElement>(".option-grid button")).find(button => button.textContent?.includes(label)) || null;
    };

    const syncLawnCategory = () => {
      const grid = root.querySelector<HTMLElement>(".option-grid");
      if (!grid) return;

      const weekly = findOriginalButton("weekly_lawn");
      const biweekly = findOriginalButton("biweekly_lawn");
      const oneTime = findOriginalButton("one_time_lawn");
      if (!weekly || !biweekly || !oneTime) return;

      const originals: Array<[ServiceKey, HTMLButtonElement]> = [
        ["weekly_lawn", weekly],
        ["biweekly_lawn", biweekly],
        ["one_time_lawn", oneTime],
      ];

      originals.forEach(([key, button]) => {
        if (button.dataset.lawnSource !== key) button.dataset.lawnSource = key;
      });

      if (weekly.dataset.lawnCategory !== "true") weekly.dataset.lawnCategory = "true";
      const mainTitle = weekly.querySelector<HTMLElement>(".option-copy strong") || weekly.querySelector<HTMLElement>("strong");
      const mainNote = weekly.querySelector<HTMLElement>(".option-copy small") || weekly.querySelector<HTMLElement>("small");
      if (mainTitle && mainTitle.textContent !== "Lawn Care") mainTitle.textContent = "Lawn Care";
      if (mainNote && mainNote.textContent !== "Choose weekly, biweekly or one-time") mainNote.textContent = "Choose weekly, biweekly or one-time";

      if (biweekly.hidden !== true) biweekly.hidden = true;
      if (oneTime.hidden !== true) oneTime.hidden = true;
      if (weekly.hidden) weekly.hidden = false;

      const selected = originals.find(([, button]) => button.classList.contains("active"))?.[0] || null;
      const categorySelected = Boolean(selected);
      if (weekly.classList.contains("lawn-category-selected") !== categorySelected) {
        weekly.classList.toggle("lawn-category-selected", categorySelected);
      }

      let picker = grid.querySelector<HTMLDivElement>(".quote-lawn-frequency-picker");
      if (!picker) {
        picker = document.createElement("div");
        picker.className = "quote-lawn-frequency-picker";
        picker.innerHTML = `
          <span class="quote-lawn-frequency-label">How often do you need lawn care?</span>
          <div class="quote-lawn-frequency-options">
            <button type="button" data-frequency-service="weekly_lawn"><strong>Weekly</strong><small>Every week</small></button>
            <button type="button" data-frequency-service="biweekly_lawn"><strong>Biweekly</strong><small>Every two weeks</small></button>
            <button type="button" data-frequency-service="one_time_lawn"><strong>One-time</strong><small>Single visit</small></button>
          </div>
        `;
        weekly.insertAdjacentElement("afterend", picker);
      }

      const shouldHidePicker = !lawnPickerExpanded;
      if (picker.hidden !== shouldHidePicker) picker.hidden = shouldHidePicker;
      picker.querySelectorAll<HTMLButtonElement>("button[data-frequency-service]").forEach(button => {
        const key = button.dataset.frequencyService as ServiceKey;
        const active = key === selected;
        if (button.classList.contains("active") !== active) button.classList.toggle("active", active);
        const label = lawnFrequencyLabels[key];
        if (label) button.setAttribute("aria-label", `${label} lawn care`);
      });
    };

    const scheduleSync = () => {
      queueMicrotask(syncLawnCategory);
      requestAnimationFrame(syncLawnCategory);
    };

    const handleClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      if (!target || !root.contains(target)) return;

      if (target.dataset.lawnCategory === "true") {
        lawnPickerExpanded = true;
        scheduleSync();
        return;
      }

      const frequencyService = target.dataset.frequencyService as ServiceKey | undefined;
      if (!frequencyService || !lawnServiceKeys.includes(frequencyService)) return;

      event.preventDefault();
      lawnPickerExpanded = true;
      findOriginalButton(frequencyService)?.click();
      scheduleSync();
    };

    const observer = new MutationObserver(syncLawnCategory);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("click", handleClick);
    syncLawnCategory();

    return () => {
      observer.disconnect();
      root.removeEventListener("click", handleClick);
    };
  }, []);

  useEffect(() => {
    const selectRequestedService = () => {
      const root = rootRef.current;
      const requestedService = readRequestedService();
      if (!root || !requestedService) return;

      let serviceButton: HTMLButtonElement | null = null;
      if (lawnServiceKeys.includes(requestedService)) {
        serviceButton = root.querySelector<HTMLButtonElement>(`button[data-lawn-source="${requestedService}"]`);
      } else {
        const label = serviceLabels[requestedService];
        serviceButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".option-grid button")).find(button => button.textContent?.includes(label)) || null;
      }

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
