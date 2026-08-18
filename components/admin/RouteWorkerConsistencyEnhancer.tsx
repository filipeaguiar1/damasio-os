"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type EmployeeReadModel = {
  id: string;
  crewId: string;
  name: string;
};

type RouteReadModel = {
  employees: EmployeeReadModel[];
  jobs: RouteLead[];
};

const PANEL_CLASS = "build-owner-inspector";
const PAGE_SIZE = 10;

function jobId(home: RouteLead) {
  return home.canonicalJobId || home.id;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

async function routeReadModel(): Promise<RouteReadModel> {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired.");

  const response = await fetch(`/api/admin/routes?date=${encodeURIComponent(operationalDateKey())}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Build ownership could not be loaded.");

  return {
    employees: (result.employees || []).map((row: any) => ({
      id: String(row.id || ""),
      crewId: String(row.crewId || ""),
      name: String(row.name || "Employee"),
    })),
    jobs: schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard)
      .filter(home => !home.canonicalVisitId),
  };
}

function renderInspector(
  panel: HTMLElement,
  employee: EmployeeReadModel | null,
  owned: RouteLead[],
  error = "",
) {
  const isOpen = panel.dataset.open === "1";
  const totalPages = Math.max(1, Math.ceil(owned.length / PAGE_SIZE));
  const requestedPage = Number(panel.dataset.page || "1");
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));
  panel.dataset.page = String(page);
  panel.replaceChildren();

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "build-owner-inspector-toggle";
  toggle.setAttribute("aria-expanded", String(isOpen));

  const copy = document.createElement("span");
  copy.className = "build-owner-inspector-copy";
  copy.append(
    text("strong", employee ? `${employee.name} · ${owned.length} owned house${owned.length === 1 ? "" : "s"}` : "Choose a worker"),
    text("small", error || (employee
      ? "Expand to verify every house that permanently belongs to this worker."
      : "Select a worker to verify permanent ownership.")),
  );

  const badge = text("b", isOpen ? "−" : "+", "build-owner-inspector-chevron");
  toggle.append(text("i", "⌂", "build-owner-inspector-icon"), copy, badge);
  toggle.addEventListener("click", () => {
    panel.dataset.open = isOpen ? "0" : "1";
    renderInspector(panel, employee, owned, error);
  });
  panel.append(toggle);

  if (!isOpen) return;

  const body = document.createElement("div");
  body.className = "build-owner-inspector-body";

  if (error) {
    body.append(text("p", error, "build-owner-inspector-empty"));
  } else if (!employee) {
    body.append(text("p", "Choose a worker first.", "build-owner-inspector-empty"));
  } else if (!owned.length) {
    body.append(text("p", "This worker currently owns 0 houses.", "build-owner-inspector-empty"));
  } else {
    const list = document.createElement("div");
    list.className = "build-owner-inspector-list";
    const start = (page - 1) * PAGE_SIZE;
    for (const home of owned.slice(start, start + PAGE_SIZE)) {
      const row = document.createElement("article");
      row.className = "build-owner-inspector-row";
      row.append(
        text("b", "✓", "build-owner-inspector-check"),
        (() => {
          const detail = document.createElement("span");
          detail.append(
            text("strong", home.name || "Customer"),
            text("small", home.address || "Address missing"),
          );
          return detail;
        })(),
        text("em", "Owned", "build-owner-inspector-status"),
      );
      list.append(row);
    }
    body.append(list);

    if (totalPages > 1) {
      const pager = document.createElement("div");
      pager.className = "build-owner-inspector-pager";
      const previous = document.createElement("button");
      previous.type = "button";
      previous.textContent = "‹";
      previous.disabled = page <= 1;
      previous.addEventListener("click", () => {
        panel.dataset.page = String(Math.max(1, page - 1));
        renderInspector(panel, employee, owned);
      });
      const next = document.createElement("button");
      next.type = "button";
      next.textContent = "›";
      next.disabled = page >= totalPages;
      next.addEventListener("click", () => {
        panel.dataset.page = String(Math.min(totalPages, page + 1));
        renderInspector(panel, employee, owned);
      });
      pager.append(previous, text("span", `Page ${page} of ${totalPages} · ${owned.length} houses`), next);
      body.append(pager);
    }
  }

  panel.append(body);
}

export function RouteWorkerConsistencyEnhancer() {
  useEffect(() => {
    let disposed = false;
    let scanTimer = 0;
    let refreshTimer = 0;
    let requestSequence = 0;

    const loadInspector = async (select: HTMLSelectElement, panel: HTMLElement, force = false) => {
      const employeeId = select.value;
      if (!force && panel.dataset.employeeId === employeeId && panel.dataset.loaded === "1") return;
      panel.dataset.employeeId = employeeId;
      panel.dataset.loaded = "0";
      panel.dataset.page = "1";
      const request = ++requestSequence;
      renderInspector(panel, employeeId ? { id: employeeId, crewId: "", name: select.selectedOptions[0]?.textContent || "Employee" } : null, []);

      try {
        const model = await routeReadModel();
        if (disposed || request !== requestSequence || panel.dataset.employeeId !== employeeId) return;
        const employee = model.employees.find(worker => worker.id === employeeId) || null;
        const owned = employee
          ? model.jobs.filter(home => home.canonicalCrewId === employee.crewId)
          : [];
        panel.dataset.loaded = "1";
        renderInspector(panel, employee, owned);
      } catch (reason) {
        if (disposed || request !== requestSequence) return;
        panel.dataset.loaded = "1";
        renderInspector(
          panel,
          employeeId ? { id: employeeId, crewId: "", name: select.selectedOptions[0]?.textContent || "Employee" } : null,
          [],
          reason instanceof Error ? reason.message : "Ownership could not be loaded.",
        );
      }
    };

    const attachBuildInspector = (select: HTMLSelectElement, anchor: HTMLElement) => {
      const host = anchor.parentElement || anchor;
      let panel = host.querySelector<HTMLElement>(`:scope > .${PANEL_CLASS}`);
      if (!panel) {
        panel = document.createElement("section");
        panel.className = PANEL_CLASS;
        panel.dataset.open = "0";
        panel.dataset.page = "1";
        anchor.insertAdjacentElement("afterend", panel);
      }
      if (select.dataset.ownerInspectorBound !== "1") {
        select.dataset.ownerInspectorBound = "1";
        select.addEventListener("change", () => {
          panel!.dataset.loaded = "0";
          void loadInspector(select, panel!, true);
        });
      }
      void loadInspector(select, panel);
    };

    const attachAdvisorIsolation = (select: HTMLSelectElement) => {
      if (select.dataset.workerIsolationBound === "1") return;
      select.dataset.workerIsolationBound = "1";
      select.addEventListener("change", () => {
        const planner = select.closest<HTMLElement>(".advanced-planner-v6");
        if (!planner) return;
        planner.classList.add("advisor-worker-switching");
        let mask = planner.querySelector<HTMLElement>(".advisor-worker-switch-mask");
        if (!mask) {
          mask = document.createElement("div");
          mask.className = "advisor-worker-switch-mask";
          mask.textContent = "Loading selected worker…";
          planner.querySelector(".planner-controls")?.insertAdjacentElement("afterend", mask);
        }
        window.setTimeout(() => {
          planner.classList.remove("advisor-worker-switching");
          mask?.remove();
        }, 450);
      });
    };

    const scan = () => {
      if (disposed) return;

      document.querySelectorAll<HTMLSelectElement>(".build-v3 .build-controls select").forEach(select => {
        const anchor = select.closest<HTMLElement>(".build-controls");
        if (anchor) attachBuildInspector(select, anchor);
      });

      document.querySelectorAll<HTMLSelectElement>(".mobile-route-builder .mobile-build-employee select").forEach(select => {
        const anchor = select.closest<HTMLElement>(".mobile-build-employee");
        if (anchor) attachBuildInspector(select, anchor);
      });

      document.querySelectorAll<HTMLSelectElement>(".advanced-planner-v6 .planner-controls select").forEach(attachAdvisorIsolation);
    };

    const scheduleScan = () => {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scan, 40);
    };

    const refreshVisibleInspectors = () => {
      document.querySelectorAll<HTMLElement>(`.${PANEL_CLASS}`).forEach(panel => {
        const previous = panel.previousElementSibling as HTMLElement | null;
        const select = previous?.querySelector<HTMLSelectElement>("select");
        if (select) {
          panel.dataset.loaded = "0";
          void loadInspector(select, panel, true);
        }
      });
    };

    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    const onRouteUpdate = () => refreshVisibleInspectors();
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".build-save button, .mobile-build-assignment > button")) return;
      window.setTimeout(refreshVisibleInspectors, 900);
      window.setTimeout(refreshVisibleInspectors, 2200);
    };
    window.addEventListener("damasio:canonical-route-updated", onRouteUpdate);
    document.addEventListener("click", onClick);
    refreshTimer = window.setInterval(refreshVisibleInspectors, 8000);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("damasio:canonical-route-updated", onRouteUpdate);
      document.removeEventListener("click", onClick);
      window.clearTimeout(scanTimer);
      window.clearInterval(refreshTimer);
    };
  }, []);

  return <style jsx global>{`
    .build-owner-inspector{display:grid;gap:0;border:1px solid #d4e5dc;border-radius:17px;background:linear-gradient(145deg,#f2f9f5,#fff);overflow:hidden;box-shadow:0 8px 22px rgba(11,77,53,.055)}
    .build-owner-inspector-toggle{display:flex;align-items:center;gap:11px;width:100%;min-height:62px;padding:11px 13px;border:0;background:transparent;color:#153e30;text-align:left;cursor:pointer}
    .build-owner-inspector-icon{display:grid;place-items:center;flex:0 0 39px;height:39px;border-radius:12px;background:#0b7655;color:#fff;font-style:normal;font-size:20px;box-shadow:0 7px 14px rgba(11,118,85,.17)}
    .build-owner-inspector-copy{display:grid;gap:2px;min-width:0;flex:1}.build-owner-inspector-copy strong{font-size:14px;font-weight:950;color:#123e2f}.build-owner-inspector-copy small{font-size:11px;line-height:1.35;color:#667c70}
    .build-owner-inspector-chevron{display:grid;place-items:center;flex:0 0 29px;height:29px;border-radius:9px;background:#e4f1ea;color:#0b7655;font-size:19px}
    .build-owner-inspector-body{display:grid;gap:8px;padding:8px;border-top:1px solid #e1ece6;background:rgba(255,255,255,.72)}
    .build-owner-inspector-list{display:grid;gap:5px}.build-owner-inspector-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid #e5eee9;border-radius:11px;background:#fff}.build-owner-inspector-check{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#e5f4eb;color:#0b7655}.build-owner-inspector-row span strong,.build-owner-inspector-row span small{display:block}.build-owner-inspector-row span strong{font-size:12px;color:#163d2f}.build-owner-inspector-row span small{margin-top:2px;font-size:10px;color:#718078}.build-owner-inspector-status{font-style:normal;font-size:9px;font-weight:950;color:#0b7655;text-transform:uppercase}
    .build-owner-inspector-empty{margin:0;padding:16px;color:#6d7f75;text-align:center;font-size:12px}.build-owner-inspector-pager{display:grid;grid-template-columns:38px 1fr 38px;align-items:center;gap:8px}.build-owner-inspector-pager button{height:34px;border:1px solid #d5e5dc;border-radius:9px;background:#fff;color:#0b7655;font-size:19px;font-weight:900}.build-owner-inspector-pager button:disabled{opacity:.35}.build-owner-inspector-pager span{text-align:center;color:#667c70;font-size:10px;font-weight:800}
    .build-v3 .build-owner-inspector{margin-top:-4px}.mobile-route-builder .build-owner-inspector{margin:10px 12px 12px}
    .advisor-worker-switch-mask{padding:11px 13px;border:1px solid #d8e8df;border-radius:13px;background:#f0f7f3;color:#246148;font-size:12px;font-weight:850}.advisor-worker-switching .planner-days,.advisor-worker-switching .planner-preview,.advisor-worker-switching .planner-actions,.advisor-worker-switching .planner-publish{opacity:.18;pointer-events:none;filter:grayscale(.25)}
    @media(max-width:650px){.build-owner-inspector{border-radius:18px}.build-owner-inspector-toggle{min-height:68px;padding:12px 13px}.build-owner-inspector-copy strong{font-size:15px}.build-owner-inspector-icon{flex-basis:42px;height:42px}.build-owner-inspector-row{grid-template-columns:30px minmax(0,1fr);padding:10px}.build-owner-inspector-status{grid-column:2}.advisor-worker-switch-mask{margin:0 0 2px}}
  `}</style>;
}
