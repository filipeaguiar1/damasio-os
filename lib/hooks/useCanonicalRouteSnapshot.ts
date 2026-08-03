"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  loadCanonicalRouteSnapshot,
  type CanonicalRouteSnapshot,
} from "@/lib/routes/canonicalRouteSnapshot";

type CanonicalRouteTarget = string | null | {
  routeId?: string | null;
  routeDate?: string | null;
};

function targetValues(target?: CanonicalRouteTarget) {
  if (typeof target === "string") {
    return { requestedRouteId: target.trim() || null, routeDate: null };
  }
  return {
    requestedRouteId: String(target?.routeId || "").trim() || null,
    routeDate: String(target?.routeDate || "").trim() || null,
  };
}

export function useCanonicalRouteSnapshot(target?: CanonicalRouteTarget) {
  const { requestedRouteId, routeDate } = targetValues(target);
  const [resolvedRouteId, setResolvedRouteId] = useState<string | null>(requestedRouteId);
  const [snapshot, setSnapshot] = useState<CanonicalRouteSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(requestedRouteId || routeDate));
  const requestRef = useRef(0);
  const activeRouteId = requestedRouteId || resolvedRouteId;

  const refresh = useCallback(async () => {
    if (!requestedRouteId && !routeDate) {
      setResolvedRouteId(null);
      setSnapshot(null);
      setError("");
      setLoading(false);
      return null;
    }

    const request = ++requestRef.current;
    try {
      const next = await loadCanonicalRouteSnapshot({
        routeId: requestedRouteId,
        routeDate: requestedRouteId ? null : routeDate,
      });
      if (request !== requestRef.current) return null;
      setResolvedRouteId(next.routeId);
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
  }, [requestedRouteId, routeDate]);

  useEffect(() => {
    requestRef.current += 1;
    setResolvedRouteId(requestedRouteId);
    setSnapshot(null);
    setError("");
    setLoading(Boolean(requestedRouteId || routeDate));
    if (!requestedRouteId && !routeDate) return;

    let disposed = false;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };
    const updated = () => refreshCurrent();
    const visible = () => {
      if (document.visibilityState === "visible") refreshCurrent();
    };

    void refresh();
    const poll = window.setInterval(refreshCurrent, 5_000);
    window.addEventListener("focus", refreshCurrent);
    window.addEventListener("damasio:canonical-route-updated", updated);
    document.addEventListener("visibilitychange", visible);

    let broadcast: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      broadcast = new BroadcastChannel("damasio-canonical-route");
      broadcast.onmessage = () => refreshCurrent();
    }

    return () => {
      disposed = true;
      requestRef.current += 1;
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshCurrent);
      window.removeEventListener("damasio:canonical-route-updated", updated);
      document.removeEventListener("visibilitychange", visible);
      broadcast?.close();
    };
  }, [requestedRouteId, routeDate, refresh]);

  useEffect(() => {
    if (!activeRouteId) return;
    let disposed = false;
    const client = getSupabaseBrowserClient() as any;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };
    const channel = client
      .channel(`canonical-route-version:${activeRouteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_order_state", filter: `route_id=eq.${activeRouteId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_stops", filter: `route_id=eq.${activeRouteId}` },
        refreshCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits", filter: `route_id=eq.${activeRouteId}` },
        refreshCurrent,
      )
      .subscribe();

    return () => {
      disposed = true;
      void client.removeChannel(channel);
    };
  }, [activeRouteId, refresh]);

  return { snapshot, error, loading, routeId: activeRouteId, refresh };
}
