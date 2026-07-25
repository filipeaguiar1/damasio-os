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

  async function generate() {
    if (!email) {
      setResult("Admin email was not found in this company.");
      return;
    }
    setBusy(true);
    setResult("Generating a temporary password…");
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
      if (!response.ok) throw new Error(payload.error || "Temporary password could not be generated.");
      setResult(`Temporary password: ${payload.temporaryPassword}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Temporary password could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  return createPortal(
    <section style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #dbe5df" }}>
      <h4 style={{ margin: "0 0 8px" }}>Admin access</h4>
      <p className="master-muted" style={{ marginBottom: 10 }}>
        Use this when Supabase email delivery is rate limited or the invitation expired.
      </p>
      <button className="master-inline-button" type="button" disabled={busy || !email} onClick={() => void generate()}>
        {busy ? "Generating…" : "Generate temporary password"}
      </button>
      {result && <p style={{ marginTop: 10, fontWeight: 700, overflowWrap: "anywhere" }}>{result}</p>}
    </section>,
    target,
  );
}
