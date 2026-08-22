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

let realtimeSubscriptionSequence = 0;

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

function isMissingDailyRoute(message: string) {
  return /no route is assigned for this date|no active canonical route remains for this date/i.test(message);
}

export function useCanonicalRouteSnapshot(target?: CanonicalRouteTarget) {
  const { requestedRouteId, routeDate } = targetValues(target);
  const [resolvedRouteId, setResolvedRouteId] = useState<string | null>(requestedRouteId);
  const [snapshot, setSnapshot] = useState<CanonicalRouteSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(requestedRouteId || routeDate));
  const requestRef = useRef(0);
  const burstRef = useRef(0);
  const snapshotRef = useRef<CanonicalRouteSnapshot | null>(null);
  const invalidateTimerRef = useRef(0);
  const targetKeyRef = useRef("");
  const activeRouteId = requestedRouteId || resolvedRouteId;
  const targetKey = `${requestedRouteId || ""}|${routeDate || ""}`;
  targetKeyRef.current = targetKey;

  const refresh = useCallback(async () => {
    if (!requestedRouteId && !routeDate) {
      setResolvedRouteId(null);
      snapshotRef.current = null;
      setSnapshot(null);
      setError("");
      setLoading(false);
      return null;
    }

    const request = ++requestRef.current;
    const requestTargetKey = `${requestedRouteId || ""}|${routeDate || ""}`;
    try {
      const next = await loadCanonicalRouteSnapshot({
        routeId: requestedRouteId,
        routeDate: requestedRouteId ? null : routeDate,
      });

      // Realtime can start several refreshes for the same Route transaction. A
      // successful newer snapshot for the current target must not be discarded
      // just because another same-target request started a few milliseconds later.
      // Route-version monotonicity below prevents an older response from winning.
      if (requestTargetKey !== targetKeyRef.current) return null;

      setResolvedRouteId(next.routeId);
      setSnapshot(current => {
        if (current?.routeId === next.routeId && current.routeVersion > next.routeVersion) {
          snapshotRef.current = current;
          return current;
        }
        snapshotRef.current = next;
        return next;
      });
      if (request === requestRef.current) setError("");
      return next;
    } catch (reason) {
      if (request === requestRef.current && requestTargetKey === targetKeyRef.current) {
        const message = reason instanceof Error ? reason.message : "Route synchronization failed.";
        if (!requestedRouteId && routeDate && isMissingDailyRoute(message)) {
          setResolvedRouteId(null);
          snapshotRef.current = null;
          setSnapshot(null);
          setError("");
        } else {
          setError(message);
        }
      }
      return null;
    } finally {
      if (request === requestRef.current && requestTargetKey === targetKeyRef.current) setLoading(false);
    }
  }, [requestedRouteId, routeDate]);

  const invalidateAndRefresh = useCallback(async () => {
    const burst = ++burstRef.current;
    const baselineVersion = snapshotRef.current?.routeVersion ?? null;
    requestRef.current += 1;
    setError("");
    setLoading(true);

    // Route writes can emit several Realtime events for one transaction. Keep a
    // short convergence window, but stop as soon as a newer canonical version is
    // visible instead of issuing a fixed seven-request burst from every screen.
    for (const delay of [0, 200, 600, 1200]) {
      if (delay) await sleep(delay);
      if (burst !== burstRef.current) return;
      const next = await refresh();
      if (!next) continue;
      if (baselineVersion === null || next.routeVersion > baselineVersion) return;
    }
  }, [refresh]);

  const scheduleInvalidate = useCallback(() => {
    window.clearTimeout(invalidateTimerRef.current);
    invalidateTimerRef.current = window.setTimeout(() => {
      void invalidateAndRefresh();
    }, 120);
  }, [invalidateAndRefresh]);

  useEffect(() => {
    requestRef.current += 1;
    burstRef.current += 1;
    window.clearTimeout(invalidateTimerRef.current);
    setResolvedRouteId(requestedRouteId);
    snapshotRef.current = null;
    setSnapshot(null);
    setError("");
    setLoading(Boolean(requestedRouteId || routeDate));
    if (!requestedRouteId && !routeDate) return;

    let disposed = false;
    const refreshCurrent = () => {
      if (!disposed) void refresh();
    };
    const invalidateCurrent = () => {
      if (!disposed) scheduleInvalidate();
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
      window.clearTimeout(invalidateTimerRef.current);
      window.clearInterval(poll);
      window.removeEventListener("focus", invalidateCurrent);
      window.removeEventListener("damasio:canonical-route-updated", invalidateCurrent);
      document.removeEventListener("visibilitychange", visible);
      broadcast?.close();
    };
  }, [requestedRouteId, routeDate, refresh, scheduleInvalidate]);

  useEffect(() => {
    if (!activeRouteId) return;
    let disposed = false;
    const client = getSupabaseBrowserClient() as any;
    const subscriptionId = ++realtimeSubscriptionSequence;
    const invalidateCurrent = () => {
      if (!disposed) scheduleInvalidate();
    };
    // Multiple page/map hook instances can observe the same Route at once. Supabase
    // must receive a unique topic for every subscription, including during the brief
    // period while an earlier channel is being removed asynchronously.
    const channel = client
      .channel(`canonical-route-version:${activeRouteId}:${subscriptionId}`)
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
  }, [activeRouteId, scheduleInvalidate]);

  return { snapshot, error, loading, routeId: activeRouteId, refresh, invalidateAndRefresh };
}
