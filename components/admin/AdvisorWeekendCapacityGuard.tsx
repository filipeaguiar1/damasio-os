"use client";

import { useEffect } from "react";

function setControlledInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Smart Week is intentionally Mon-Fri by default. Older/stale weekend Visits must
 * not silently turn Sat/Sun into available planning capacity just because they
 * already exist in the canonical snapshot. The planner can still show those
 * Visits as over-capacity so Admin can Move/Remove them, and Admin may explicitly
 * opt into weekend work by editing the capacity after the week is loaded.
 */
export function AdvisorWeekendCapacityGuard() {
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let previousSignature = "";

    const applyDefault = () => {
      if (disposed) return;
      const root = document.querySelector(".advanced-planner-v7");
      if (!root) return;
      const employee = root.querySelector<HTMLSelectElement>(".planner-controls select");
      const week = root.querySelector<HTMLInputElement>('.planner-controls input[type="date"]');
      const signature = `${employee?.value || ""}:${week?.value || ""}`;
      if (!signature || signature === ":" || signature === previousSignature) return;
      previousSignature = signature;
      const currentGeneration = ++generation;

      // React can finish the async route refresh shortly after Employee/week changes.
      // Re-assert the default a few times only during that load window. Afterward,
      // manual Admin edits remain untouched.
      [0, 180, 650, 1400].forEach(delay => {
        window.setTimeout(() => {
          if (disposed || currentGeneration !== generation) return;
          const labels = [...root.querySelectorAll<HTMLLabelElement>(".planner-capacities label")];
          for (const label of labels) {
            const day = label.querySelector("span")?.textContent?.trim();
            if (day !== "Sat" && day !== "Sun") continue;
            const input = label.querySelector<HTMLInputElement>("input");
            if (input && Number(input.value || 0) !== 0) setControlledInput(input, "0");
          }
        }, delay);
      });
    };

    const onPlannerSelection = () => {
      previousSignature = "";
      applyDefault();
    };
    const rootObserver = new MutationObserver(() => applyDefault());
    rootObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", event => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".advanced-planner-v7 .planner-controls")) onPlannerSelection();
    }, true);
    window.addEventListener("damasio:canonical-route-updated", applyDefault as EventListener);
    applyDefault();

    return () => {
      disposed = true;
      generation += 1;
      rootObserver.disconnect();
      window.removeEventListener("damasio:canonical-route-updated", applyDefault as EventListener);
    };
  }, []);

  return null;
}
