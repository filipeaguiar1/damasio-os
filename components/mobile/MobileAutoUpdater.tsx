"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const VERSION_KEY = "damasio-mobile-build";
const UPDATED_KEY = "damasio-mobile-updated";

export function MobileAutoUpdater() {
  const pathname = usePathname();
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(UPDATED_KEY) !== "yes") return;

    sessionStorage.removeItem(UPDATED_KEY);
    setUpdated(true);
    const timer = window.setTimeout(() => setUpdated(false), 2800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let stopped = false;

    async function check() {
      if (document.visibilityState === "hidden") return;

      try {
        const response = await fetch(`/api/mobile/version?t=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        if (!response.ok) return;

        const { version } = (await response.json()) as { version?: string };
        if (!version || stopped) return;

        const current = localStorage.getItem(VERSION_KEY);
        if (!current) {
          localStorage.setItem(VERSION_KEY, version);
          return;
        }
        if (current === version) return;

        // Store the new version before reloading so the Employee app cannot get
        // trapped in a reload loop. Employee screens must update too; otherwise
        // they keep running stale route and Smart Route client code after deploys.
        localStorage.setItem(VERSION_KEY, version);
        sessionStorage.setItem(UPDATED_KEY, "yes");
        window.location.reload();
      } catch {
        // A failed update check must never interrupt field work.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, 60_000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return updated ? (
    <div className="mobile-update-toast" role="status">
      App updated
    </div>
  ) : null;
}
