"use client";

import { useEffect } from "react";

const QUICK_ACCESS_CLASS = "advisor-house-quick-access";

function readNumber(value: string | null | undefined) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function ensureCustomerPanel(planner: HTMLElement, heroAction: HTMLButtonElement) {
  if (!planner.querySelector(".planner-customer-groups")) heroAction.click();
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

        const planned = readNumber(summary.querySelector("b")?.textContent);
        const summaryText = summary.textContent || "";
        const newMatch = summaryText.match(/(\d+)\s+new\/unplaced/i);
        const newCount = newMatch ? Number(newMatch[1]) : 0;
        const totalMatch = heroAction.textContent?.match(/\((\d+)\)/);
        const total = totalMatch ? Number(totalMatch[1]) : Math.max(planned + newCount, planned);
        const isOpen = Boolean(planner.querySelector(".planner-customer-groups"));
        const selected = planner.querySelectorAll(".planner-new-customers > button.active").length;
        const signature = `${planned}:${newCount}:${total}:${selected}:${isOpen}`;

        let quick = planner.querySelector<HTMLElement>(`.${QUICK_ACCESS_CLASS}`);
        if (!quick) {
          quick = document.createElement("section");
          quick.className = QUICK_ACCESS_CLASS;
          quick.setAttribute("aria-label", "House selection");
          summary.insertAdjacentElement("afterend", quick);
        }
        if (quick.dataset.signature === signature) return;
        quick.dataset.signature = signature;
        quick.classList.toggle("open", isOpen);

        quick.innerHTML = `
          <button type="button" class="aqa-toggle" aria-expanded="${isOpen}">
            <span class="aqa-icon">⌂</span>
            <span class="aqa-copy">
              <strong>Houses</strong>
              <small>${planned} canonical in week${selected ? ` · ${selected} new selected` : ""}</small>
            </span>
            <span class="aqa-chevron">${isOpen ? "−" : "+"}</span>
          </button>
          <div class="aqa-stats">
            <button type="button" class="aqa-stat aqa-all"><span>All houses</span><strong>${total}</strong><small>View current + new</small></button>
            <button type="button" class="aqa-stat aqa-new ${newCount ? "has-new" : ""}"><span>New houses</span><strong>${newCount}</strong><small>${newCount ? "Select houses to place" : "Nothing waiting"}</small></button>
          </div>
        `;

        quick.querySelector<HTMLButtonElement>(".aqa-toggle")?.addEventListener("click", () => heroAction.click());
        quick.querySelector<HTMLButtonElement>(".aqa-new")?.addEventListener("click", () => {
          ensureCustomerPanel(planner, heroAction);
          window.setTimeout(() => planner.querySelector<HTMLElement>(".planner-new-customers")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 40);
        });
        quick.querySelector<HTMLButtonElement>(".aqa-all")?.addEventListener("click", () => {
          ensureCustomerPanel(planner, heroAction);
          window.setTimeout(() => {
            const existing = planner.querySelector<HTMLElement>(".planner-existing");
            const existingList = planner.querySelector(".planner-existing-list");
            if (existing && !existingList) existing.querySelector<HTMLButtonElement>(".planner-existing-toggle")?.click();
            planner.querySelector<HTMLElement>(".planner-customer-groups")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 40);
        });
      });
    };

    const scheduleEnhance = () => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(enhance, 30);
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
    .planner-controls>.advisor-house-quick-access{grid-column:1/-1}
    .advisor-house-quick-access{display:grid;gap:9px;margin-top:2px;padding:10px;border:1px solid #c9dfd3;border-radius:17px;background:linear-gradient(145deg,#eef8f3,#fff);box-shadow:0 7px 18px rgba(10,73,50,.055)}
    .advisor-house-quick-access .aqa-toggle{display:flex;align-items:center;gap:11px;width:100%;min-height:48px;padding:4px;border:0;background:transparent;color:#153e30;text-align:left;cursor:pointer}
    .advisor-house-quick-access .aqa-icon{display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:11px;background:linear-gradient(145deg,#08714f,#0c9365);color:#fff;font-size:20px;box-shadow:0 7px 14px rgba(11,118,85,.18)}
    .advisor-house-quick-access .aqa-copy{display:grid;gap:2px;min-width:0;flex:1}.advisor-house-quick-access .aqa-copy strong{font-size:15px;font-weight:950;color:#123e2f}.advisor-house-quick-access .aqa-copy small{font-size:11px;color:#667c70}
    .advisor-house-quick-access .aqa-chevron{display:grid;place-items:center;flex:0 0 30px;height:30px;border-radius:9px;background:#e0efe7;color:#0b7655;font-size:20px;font-weight:900}
    .advisor-house-quick-access .aqa-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .advisor-house-quick-access .aqa-stat{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;min-height:62px;padding:10px 12px;border:1px solid #d8e7df;border-radius:13px;background:#fff;color:#173a2c;text-align:left;cursor:pointer;box-shadow:0 3px 10px rgba(10,70,48,.035)}
    .advisor-house-quick-access .aqa-stat:hover{border-color:#8abfa5;background:#f8fcfa}.advisor-house-quick-access .aqa-stat span{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:#60766a}.advisor-house-quick-access .aqa-stat strong{grid-row:1/3;grid-column:2;font-size:25px;line-height:1;color:#0b684c}.advisor-house-quick-access .aqa-stat small{font-size:11px;color:#718078}.advisor-house-quick-access .aqa-stat.has-new{border-color:#83bda0;background:linear-gradient(145deg,#e8f7ee,#fff)}.advisor-house-quick-access .aqa-stat.has-new strong{color:#08714f}
    @media(max-width:650px){.planner-controls>.advisor-house-quick-access{margin-top:2px}.advisor-house-quick-access{padding:9px;border-radius:15px}.advisor-house-quick-access .aqa-stats{grid-template-columns:1fr 1fr}.advisor-house-quick-access .aqa-stat{min-height:66px;padding:9px}.advisor-house-quick-access .aqa-stat strong{font-size:23px}.advisor-house-quick-access .aqa-stat small{font-size:10px}.advanced-planner-v6 .planner-customer-groups{scroll-margin-top:10px}}
  `}</style>;
}
