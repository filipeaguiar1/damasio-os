"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  loadCanonicalRouteSnapshot,
  type CanonicalRouteSnapshot,
} from "@/lib/routes/canonicalRouteSnapshot";

export function useCanonicalRouteSnapshot(routeId?: string | null) {
  const [snapshot, setSnapshot] = useState<CanonicalRouteSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(routeId));
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!routeId) {
      setSnapshot(null);
      setError("");
      setLoading(false);
      return null;
    }

    const request = ++requestRef.current;
    try {
      const next = await loadCanonicalRouteSnapshot({ routeId });
      if (request !== requestRef.current) return null;
      setSnapshot(current => {
        if (current?.routeId === next.routeId && current.routeVersion > next.routeVersion) {
          return current;
        }
        return next;
      });
      setError("");
      return next;
    } catch (reason) {
      if (request === requestRef.current) {
        setError(reason instanceof Error ? reason.message : "Route synchronization failed.");
      }
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    requestRef.current += 1;
    setSnapshot(null);
    setError("");
    setLoading(Boolean(routeId));
    if (!routeId) return;

    let disposed = false;
    const client = getSupabaseBrowserClient() as any;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };

    void refresh();
    const channel = client
      .channel(`canonical-route-version:${routeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_order_state", filter: `route_id=eq.${routeId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_stops", filter: `route_id=eq.${routeId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits", filter: `route_id=eq.${routeId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "employee_smart_route_state", filter: `route_id=eq.${routeId}` },
        refreshCurrent,
      )
      .subscribe();

    const poll = window.setInterval(refreshCurrent, 5_000);
    const visible = () => {
      if (document.visibilityState === "visible") refreshCurrent();
    };
    window.addEventListener("focus", refreshCurrent);
    document.addEventListener("visibilitychange", visible);

    return () => {
      disposed = true;
      requestRef.current += 1;
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshCurrent);
      document.removeEventListener("visibilitychange", visible);
      void client.removeChannel(channel);
    };
  }, [routeId, refresh]);

  return { snapshot, error, loading, refresh };
}
