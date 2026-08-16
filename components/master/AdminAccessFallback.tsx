"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AdminAccessFallback() {
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    if (pathname !== "/master") {
      setTarget(null);
      return;
    }

    const sync = () => {
      const modal = document.querySelector<HTMLElement>(".master-modal");
      if (!modal) {
        setTarget(null);
        setEmail("");
        setResult("");
        return;
      }
      const summaryEmail = modal.querySelector<HTMLElement>(".master-detail-summary small")?.textContent?.trim() || "";
      const adminEmails = Array.from(modal.querySelectorAll<HTMLElement>(".master-person small"))
        .map((node) => node.textContent?.trim() || "")
        .find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
      setTarget(modal);
      setEmail(adminEmails || summaryEmail);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  async function sendRecovery() {
    if (!email) {
      setResult("Admin email was not found in this company.");
      return;
    }
    setBusy(true);
    setResult("Sending secure recovery link…");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your Master session expired. Sign in again.");
      const response = await fetch("/api/master/admin-access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Recovery link could not be sent.");
      setResult(payload.message || `Recovery link sent to ${email}.`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Recovery link could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  return createPortal(
    <section style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #dbe5df" }}>
      <h4 style={{ margin: "0 0 8px" }}>Admin access</h4>
      <p className="master-muted" style={{ marginBottom: 10 }}>
        Send a secure recovery link without changing or exposing the Admin&apos;s existing password.
      </p>
      <button className="master-inline-button" type="button" disabled={busy || !email} onClick={() => void sendRecovery()}>
        {busy ? "Sending…" : "Send Admin recovery link"}
      </button>
      {result && <p style={{ marginTop: 10, fontWeight: 700, overflowWrap: "anywhere" }}>{result}</p>}
    </section>,
    target,
  );
}
