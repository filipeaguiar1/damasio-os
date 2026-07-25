"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Lead = {
  id: string;
  full_name: string;
  email?: string | null;
  assigned_company_id?: string | null;
  status?: string;
};

export default function PlatformRegistrationAction() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadLeads = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowserClient() as any;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const response = await fetch("/api/master/companies", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (response.ok) setLeads(result.leads || []);
    } catch {
      // The main Master page already handles session and loading errors.
    }
  }, []);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    const locateModal = () => {
      const modal = document.querySelector<HTMLElement>(".master-modal");
      const title = modal?.querySelector("h3")?.textContent?.trim() || "";

      if (!modal || !title.startsWith("Quote response:")) {
        setTarget(null);
        setLead(null);
        setMessage("");
        return;
      }

      const customerName = title.replace(/^Quote response:\s*/, "").trim().toLowerCase();
      const matchedLead = leads.find((item) => item.full_name.trim().toLowerCase() === customerName) || null;
      const form = modal.querySelector<HTMLElement>("form.master-form");
      if (!form || !matchedLead) return;

      let mount = form.querySelector<HTMLElement>("[data-platform-registration-action]");
      if (!mount) {
        mount = document.createElement("div");
        mount.dataset.platformRegistrationAction = "true";
        form.prepend(mount);
      }

      setTarget(mount);
      setLead(matchedLead);
    };

    locateModal();
    const observer = new MutationObserver(locateModal);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [leads]);

  async function sendRegistrationAccess() {
    if (!lead || busy) return;
    if (!lead.email) {
      setMessage("Add an email to this lead before sending registration access.");
      return;
    }

    setBusy(true);
    setMessage("Sending platform registration access…");
    try {
      const supabase = getSupabaseBrowserClient() as any;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your Master login expired. Sign in again.");

      const response = await fetch(`/api/master/leads/${lead.id}/registration-access`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Registration access could not be sent.");

      setMessage(result.message || "Registration access sent. The customer remains unassigned.");
      setLeads((current) => current.map((item) => item.id === lead.id
        ? { ...item, assigned_company_id: null, status: "registration_sent" }
        : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration access could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (!target || !lead) return null;

  return createPortal(
    <section style={{
      border: "1px solid #d9e6df",
      borderRadius: 12,
      padding: 14,
      marginBottom: 14,
      background: "#f6fbf8",
    }}>
      <strong style={{ display: "block", marginBottom: 5 }}>Platform registration</strong>
      <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.45 }}>
        Send customer access without assigning a company. The customer stays Unassigned until the Master chooses a service company.
      </p>
      <button
        type="button"
        className="master-inline-button"
        disabled={busy || !lead.email}
        onClick={() => void sendRegistrationAccess()}
      >
        {busy ? "Sending…" : "Send platform registration access"}
      </button>
      {message && <p style={{ margin: "9px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{message}</p>}
    </section>,
    target,
  );
}
