"use client";

import { useEffect } from "react";

function optionMatches(option: HTMLOptionElement, query: string) {
  if (!query) return true;
  return option.textContent?.toLowerCase().includes(query) || option.value.toLowerCase().includes(query);
}

export function CustomerSelectSearchEnhancer() {
  useEffect(() => {
    if (!location.pathname.startsWith("/admin") && !location.pathname.startsWith("/master")) return;

    const enhance = () => {
      const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
      selects.forEach((select) => {
        if (select.dataset.customerSearchEnhanced === "true") return;

        const label = select.closest("label");
        const labelText = label?.textContent?.toLowerCase() || "";
        if (!label || !labelText.includes("customer")) return;

        const container = label.parentElement;
        if (!container || container.querySelector("[data-customer-select-filter='true']")) return;
        if ((container.textContent || "").toLowerCase().includes("find customer")) return;

        select.dataset.customerSearchEnhanced = "true";
        const searchLabel = document.createElement("label");
        searchLabel.className = "customer-select-filter-field";
        searchLabel.dataset.customerSelectFilter = "true";
        searchLabel.innerHTML = `<span>Find customer</span><input type="search" placeholder="Search by name or email" autocomplete="off" />`;

        const input = searchLabel.querySelector("input");
        input?.addEventListener("input", () => {
          const query = input.value.trim().toLowerCase();
          // Filtering is intentionally non-mutating: searching must never change
          // a financial action's selected Customer without an explicit user choice.
          Array.from(select.options).forEach((option) => {
            const visible = !option.value || optionMatches(option, query);
            option.hidden = !visible;
          });
        });

        container.insertBefore(searchLabel, label);
      });
    };

    enhance();
    const observer = new MutationObserver(() => window.requestAnimationFrame(enhance));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
