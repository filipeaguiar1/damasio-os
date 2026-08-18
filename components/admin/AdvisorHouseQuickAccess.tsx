"use client";

import { useEffect } from "react";

const QUICK_ACCESS_CLASS = "advisor-house-quick-access";

function readNumber(value: string | null | undefined) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function AdvisorHouseQuickAccess() {
  useEffect(() => {
    let scheduled = 0;

    const enhance = () => {
      document.querySelectorAll<HTMLElement>(".advanced-planner-v6").forEach((planner) => {
        const controls = planner.querySelector<HTMLElement>(".planner-controls");
        const summary = planner.querySelector<HTMLElement>(".planner-summary");
        const heroAction = planner.querySelector<HTMLButtonElement>(".planner-hero-action");
        if (!controls || !summary || !heroAction) return;

        let quick = planner.querySelector<HTMLButtonElement>(`.${QUICK_ACCESS_CLASS}`);
        if (!quick) {
          quick = document.createElement("button");
          quick.type = "button";
          quick.className = QUICK_ACCESS_CLASS;
          quick.setAttribute("aria-expanded", "false");
          controls.insertAdjacentElement("afterend", quick);
          quick.addEventListener("click", () => heroAction.click());
        }

        const planned = readNumber(summary.querySelector("b")?.textContent);
        const summaryText = summary.textContent || "";
        const newMatch = summaryText.match(/(\d+)\s+new\/unplaced/i);
        const newCount = newMatch ? Number(newMatch[1]) : 0;
        const totalMatch = heroAction.textContent?.match(/\((\d+)\)/);
        const total = totalMatch ? Number(totalMatch[1]) : Math.max(planned + newCount, planned);
        const isOpen = Boolean(planner.querySelector(".planner-customer-groups"));
        const selected = planner.querySelectorAll(".planner-new-customers > button.active").length;

        quick.setAttribute("aria-expanded", String(isOpen));
        quick.classList.toggle("open", isOpen);
        quick.innerHTML = `
          <span class="aqa-icon">⌂</span>
          <span class="aqa-copy">
            <strong>${isOpen ? "Hide houses" : "Houses"}</strong>
            <small>${planned} in week · ${newCount} new · ${total} total${selected ? ` · ${selected} selected` : ""}</small>
          </span>
          <span class="aqa-chevron">${isOpen ? "−" : "+"}</span>
        `;
      });
    };

    const scheduleEnhance = () => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(enhance, 20);
    };

    enhance();
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("damasio:canonical-route-updated", scheduleEnhance);

    return () => {
      observer.disconnect();
      window.removeEventListener("damasio:canonical-route-updated", scheduleEnhance);
      window.clearTimeout(scheduled);
    };
  }, []);

  return <style jsx global>{`
    .advisor-house-quick-access{
      display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:11px 14px;
      border:1px solid #c9dfd3;border-radius:16px;background:linear-gradient(135deg,#eff8f3,#ffffff);
      color:#153e30;text-align:left;cursor:pointer;box-shadow:0 7px 18px rgba(10,73,50,.06);
      transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;
    }
    .advisor-house-quick-access:hover{transform:translateY(-1px);border-color:#86bea2;box-shadow:0 10px 22px rgba(10,73,50,.09)}
    .advisor-house-quick-access.open{border-color:#69ad8b;background:linear-gradient(135deg,#e3f5ea,#f8fcfa)}
    .advisor-house-quick-access .aqa-icon{display:grid;place-items:center;flex:0 0 40px;height:40px;border-radius:12px;background:#0b7655;color:#fff;font-size:21px;box-shadow:0 7px 14px rgba(11,118,85,.18)}
    .advisor-house-quick-access .aqa-copy{display:grid;gap:2px;min-width:0;flex:1}
    .advisor-house-quick-access .aqa-copy strong{font-size:15px;font-weight:950;color:#123e2f}
    .advisor-house-quick-access .aqa-copy small{font-size:12px;color:#667c70;white-space:normal}
    .advisor-house-quick-access .aqa-chevron{display:grid;place-items:center;flex:0 0 30px;height:30px;border-radius:9px;background:#e4f1ea;color:#0b7655;font-size:20px;font-weight:900}
    @media(max-width:650px){
      .advisor-house-quick-access{min-height:70px;padding:12px 14px;border-radius:18px;background:linear-gradient(135deg,#e9f7ef,#fff);box-shadow:0 8px 22px rgba(11,79,55,.07)}
      .advisor-house-quick-access .aqa-icon{flex-basis:44px;height:44px;border-radius:13px}
      .advisor-house-quick-access .aqa-copy strong{font-size:16px}.advisor-house-quick-access .aqa-copy small{font-size:11px;line-height:1.35}
      .advanced-planner-v6 .planner-customer-groups{scroll-margin-top:10px}
    }
  `}</style>;
}
