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

function sleep(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

export function useCanonicalRouteSnapshot(target?: CanonicalRouteTarget) {
  const { requestedRouteId, routeDate } = targetValues(target);
  const [resolvedRouteId, setResolvedRouteId] = useState<string | null>(requestedRouteId);
  const [snapshot, setSnapshot] = useState<CanonicalRouteSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(requestedRouteId || routeDate));
  const requestRef = useRef(0);
  const burstRef = useRef(0);
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

  const invalidateAndRefresh = useCallback(async () => {
    const burst = ++burstRef.current;
    requestRef.current += 1;
    setSnapshot(null);
    setError("");
    setLoading(true);

    // A database transaction, Realtime delivery, server geocoding and road
    // geometry generation do not necessarily become visible at the same instant.
    // Complete the whole convergence burst instead of stopping on the first
    // successful response, which may still be the previous route membership.
    for (const delay of [0, 150, 350, 700, 1200, 2000, 3000]) {
      if (delay) await sleep(delay);
      if (burst !== burstRef.current) return;
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    requestRef.current += 1;
    burstRef.current += 1;
    setResolvedRouteId(requestedRouteId);
    setSnapshot(null);
    setError("");
    setLoading(Boolean(requestedRouteId || routeDate));
    if (!requestedRouteId && !routeDate) return;

    let disposed = false;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };
    const invalidateCurrent = () => {
      if (!disposed) void invalidateAndRefresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") invalidateCurrent();
    };

    void refresh();
    const poll = window.setInterval(refreshCurrent, 5_000);
    window.addEventListener("focus", invalidateCurrent);
    window.addEventListener("damasio:canonical-route-updated", invalidateCurrent);
    document.addEventListener("visibilitychange", visible);

    let broadcast: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      broadcast = new BroadcastChannel("damasio-canonical-route");
      broadcast.onmessage = () => invalidateCurrent();
    }

    return () => {
      disposed = true;
      requestRef.current += 1;
      burstRef.current += 1;
      window.clearInterval(poll);
      window.removeEventListener("focus", invalidateCurrent);
      window.removeEventListener("damasio:canonical-route-updated", invalidateCurrent);
      document.removeEventListener("visibilitychange", visible);
      broadcast?.close();
    };
  }, [requestedRouteId, routeDate, refresh, invalidateAndRefresh]);

  useEffect(() => {
    if (!activeRouteId) return;
    let disposed = false;
    const client = getSupabaseBrowserClient() as any;
    const invalidateCurrent = () => {
      if (!disposed) void invalidateAndRefresh();
    };
    const channel = client
      .channel(`canonical-route-version:${activeRouteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_order_state", filter: `route_id=eq.${activeRouteId}` },
        invalidateCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "route_stops", filter: `route_id=eq.${activeRouteId}` },
        invalidateCurrent,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits", filter: `route_id=eq.${activeRouteId}` },
        invalidateCurrent,
      )
      .subscribe();

    return () => {
      disposed = true;
      void client.removeChannel(channel);
    };
  }, [activeRouteId, invalidateAndRefresh]);

  return { snapshot, error, loading, routeId: activeRouteId, refresh, invalidateAndRefresh };
}
