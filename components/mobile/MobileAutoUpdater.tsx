"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const VERSION_KEY = "damasio-mobile-build";
const PENDING_VERSION_KEY = "damasio-mobile-pending-build";
const SESSION_VERSION_KEY = "damasio-mobile-session-build";
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
        const response = await fetch("/api/mobile/version", {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        if (!response.ok) return;

        const { version } = await response.json() as { version?: string };
        if (!version || stopped) return;

        const currentVersion = localStorage.getItem(VERSION_KEY);
        const sessionVersion = sessionStorage.getItem(SESSION_VERSION_KEY);

        if (!currentVersion) {
          localStorage.setItem(VERSION_KEY, version);
          sessionStorage.setItem(SESSION_VERSION_KEY, version);
          localStorage.removeItem(PENDING_VERSION_KEY);
          return;
        }

        if (currentVersion === version) {
          sessionStorage.setItem(SESSION_VERSION_KEY, version);
          localStorage.removeItem(PENDING_VERSION_KEY);
          return;
        }

        const isEmployeeApp = pathname.startsWith("/mobile/employee");

        // Never interrupt an Employee who is already working in this open app
        // session. Record the new build and install it automatically after the
        // app is closed and opened again, when sessionStorage starts empty.
        if (isEmployeeApp && sessionVersion) {
          localStorage.setItem(PENDING_VERSION_KEY, version);
          return;
        }

        localStorage.setItem(VERSION_KEY, version);
        localStorage.removeItem(PENDING_VERSION_KEY);
        sessionStorage.setItem(SESSION_VERSION_KEY, version);
        sessionStorage.setItem(UPDATED_KEY, "yes");
        window.location.reload();
      } catch {
        // Update checks must never block field work while connectivity is poor.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, 5 * 60 * 1000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return updated
    ? <div className="mobile-update-toast" role="status">App updated</div>
    : null;
}
