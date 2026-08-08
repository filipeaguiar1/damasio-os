"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  InteractiveRoutePreviewMap,
  type RoutePreviewMetrics,
} from "@/components/admin/InteractiveRoutePreviewMap";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import { canonicalRouteLeadsForEmployee } from "@/lib/routes/canonicalRouteIdentity";
import { useCanonicalRouteSnapshot } from "@/lib/hooks/useCanonicalRouteSnapshot";
import type { CanonicalRouteSnapshot } from "@/lib/routes/canonicalRouteSnapshot";
import {
  planningDates,
  recommendRoutePlacements,
  type AdvisorPoint,
  type RouteAdvisorRecommendation,
} from "@/lib/routes/routeAdvisor";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
  dailyCapacity: number;
};

type AdminEmployee = {
  id: string;
  daily_route_capacity?: number | null;
};

type Origin = AdvisorPoint & { label: string };
type SmartOriginMode = "current" | "last" | "manual" | "profile";
type RemovedStop = { home: RouteLead; index: number };

const coordinateCache = new Map<string, AdvisorPoint>();

function canonicalJobId(home: RouteLead) {
  return home.canonicalJobId || home.id;
}

function canonicalVisitId(home: RouteLead) {
  return home.canonicalVisitId || "";
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function priority(status?: string) {
  if (status === "completed") return 1;
  if (status === "in_progress") return 2;
  if (status === "scheduled") return 3;
  if (status === "missed") return 4;
  return 5;
}

function routeStatus(home?: RouteLead | null) {
  return home?.canonicalVisitStatus || "";
}

function normalizeOrder(items: RouteLead[]) {
  return items.map((item, index) => ({ ...item, routeOrder: index + 1 }));
}

function formatDistance(value: number | null) {
  return value === null ? "Calculating…" : `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
}

function formatDuration(value: number | null) {
  return value === null ? "Calculating…" : `${Math.max(1, Math.round(value / 60))} min`;
}

async function accessToken() {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

async function geocode(address: string) {
  const key = address.trim().toLowerCase();
  const cached = coordinateCache.get(key);
  if (cached) return cached;
  const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Address could not be mapped: ${address}`);
  const point = await response.json() as AdvisorPoint;
  coordinateCache.set(key, point);
  return point;
}

async function locate(home: RouteLead) {
  if (Number.isFinite(home.latitude) && Number.isFinite(home.longitude)) {
    return { ...home, latitude: Number(home.latitude), longitude: Number(home.longitude) };
  }
  const point = await geocode(home.address);
  return { ...home, ...point };
}

function routeLeadsFromSnapshot(snapshot: CanonicalRouteSnapshot | null): RouteLead[] {
  if (!snapshot) return [];
  return snapshot.stops.map(stop => ({
    id: stop.visitId,
    createdAt: stop.scheduledDate ? `${stop.scheduledDate}T12:00:00.000Z` : snapshot.updatedAt,
    name: stop.customerName,
    phone: "",
    email: "",
    address: stop.address,
    service: stop.serviceName,
    status: stop.status === "completed" ? "completed" as const : "booked" as const,
    subtotal: 0,
    tax: 0,
    total: 0,
    photos: [],
    scheduledDate: stop.scheduledDate || snapshot.routeDate,
    nextVisitDate: stop.scheduledDate || snapshot.routeDate,
    routeOrder: stop.routeOrder,
    latitude: stop.latitude ?? undefined,
    longitude: stop.longitude ?? undefined,
    canonicalVisitId: stop.visitId,
    canonicalJobId: stop.jobId || undefined,
    canonicalRouteId: snapshot.routeId,
    canonicalCustomerId: stop.customerId || undefined,
    canonicalPropertyId: stop.propertyId || undefined,
    canonicalEmployeeId: stop.employeeId || undefined,
    canonicalCrewId: stop.crewId || undefined,
    canonicalVisitStatus: stop.status as RouteLead["canonicalVisitStatus"],
    visitStartedAt: stop.startedAt || undefined,
    visitFinishedAt: stop.finishedAt || undefined,
    visitDurationSeconds: stop.durationSeconds ?? undefined,
  }));
}

export function RouteAdvisorPanel() {
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(operationalDateKey());
  const [query, setQuery] = useState("");
  const [recommendations, setRecommendations] = useState<RouteAdvisorRecommendation[]>([]);
  const [preview, setPreview] = useState<RouteLead[]>([]);
  const [removed, setRemoved] = useState<RemovedStop[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [lockedJobIds, setLockedJobIds] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<RoutePreviewMetrics>({
    distanceMeters: null,
    durationSeconds: null,
  });
  const [reopenCandidate, setReopenCandidate] = useState<RouteLead | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenConfirmation, setReopenConfirmation] = useState("");
  const [message, setMessage] = useState("Loading route data...");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [smartOriginMode, setSmartOriginMode] = useState<SmartOriginMode>("current");
  const [smartRouteAddress, setSmartRouteAddress] = useState("");
  const [manualOriginPoint, setManualOriginPoint] = useState<Origin | null>(null);
  const [manualOrderOpen, setManualOrderOpen] = useState(true);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await accessToken();
      const headers = { authorization: `Bearer ${token}` };
      const [routeResponse, employeeResponse] = await Promise.all([
        fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`, { headers, cache: "no-store" }),
        fetch("/api/admin/users", { headers, cache: "no-store" }),
      ]);
      const routeResult = await routeResponse.json();
      const employeeResult = await employeeResponse.json().catch(() => ({ users: [] }));
      if (!routeResponse.ok) throw new Error(routeResult.error || "Routes could not be loaded.");

      const profiles = new Map<string, AdminEmployee>(
        (employeeResult.users || []).map((item: AdminEmployee) => [item.id, item]),
      );
      const realEmployees: RouteEmployee[] = (routeResult.employees || []).map(
        (item: Omit<RouteEmployee, "dailyCapacity">) => ({
          ...item,
          dailyCapacity: Math.max(1, Number(profiles.get(item.id)?.daily_route_capacity || 16)),
        }),
      );

      setEmployees(realEmployees);
      setLeads(schedulingBoardToLeads((routeResult.board || {}) as SchedulingDispatchBoard));
      setEmployeeId(current =>
        realEmployees.some(item => item.id === current)
          ? current
          : realEmployees[0]?.id || "");
      if (!silent) setMessage(realEmployees.length ? "" : "Add an active Employee before planning routes.");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "Route data could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const jobs = useMemo(() => leads.filter(item => !item.canonicalVisitId), [leads]);
  const visits = useMemo(() => leads.filter(item => Boolean(item.canonicalVisitId)), [leads]);
  const employee = employees.find(item => item.id === employeeId) || null;
  const employeeIdentity = employee
    ? { id: employee.employeeId || employee.id, crewId: employee.crewId }
    : null;
  const selected = useMemo(() => new Set(selectedJobIds), [selectedJobIds]);

  const occurrencesOnDate = useMemo(() => {
    const map = new Map<string, RouteLead>();
    const ordered = visits
      .filter(item => item.scheduledDate === date)
      .sort((left, right) =>
        priority(routeStatus(left)) - priority(routeStatus(right))
        || left.createdAt.localeCompare(right.createdAt));
    for (const visit of ordered) {
      const id = canonicalJobId(visit);
      if (!map.has(id)) map.set(id, visit);
    }
    return map;
  }, [visits, date]);

  const latestMissedByJob = useMemo(() => {
    const map = new Map<string, RouteLead>();
    const missed = visits
      .filter(item => routeStatus(item) === "missed")
      .sort((left, right) =>
        (right.scheduledDate || "").localeCompare(left.scheduledDate || "")
        || right.createdAt.localeCompare(left.createdAt));
    for (const visit of missed) {
      const id = canonicalJobId(visit);
      if (!map.has(id)) map.set(id, visit);
    }
    return map;
  }, [visits]);

  const routeCandidates = useMemo(() => {
    if (!employeeIdentity) return [];
    const datedVisits = visits.filter(item => item.scheduledDate === date);
    return canonicalRouteLeadsForEmployee(datedVisits, employeeIdentity)
      .sort((left, right) =>
        (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
        || canonicalVisitId(left).localeCompare(canonicalVisitId(right)));
  }, [visits, date, employeeIdentity?.id, employeeIdentity?.crewId]);
  const currentRouteId = routeCandidates[0]?.canonicalRouteId || null;
  const {
    snapshot: liveRouteSnapshot,
    error: liveRouteError,
    refresh: refreshLiveRoute,
  } = useCanonicalRouteSnapshot(currentRouteId);
  const currentRoute = useMemo(() =>
    liveRouteSnapshot ? routeLeadsFromSnapshot(liveRouteSnapshot) : routeCandidates,
  [liveRouteSnapshot, routeCandidates]);

  useEffect(() => {
    if (liveRouteError) setMessage(liveRouteError);
  }, [liveRouteError]);

  const lastCompleted = useMemo(() => currentRoute
    .filter(item => routeStatus(item) === "completed")
    .slice()
    .sort((left, right) =>
      (left.visitFinishedAt || "").localeCompare(right.visitFinishedAt || "")
      || (left.routeOrder ?? 0) - (right.routeOrder ?? 0))
    .at(-1) || null,
  [currentRoute]);
  const profileStartAddress = employee?.routeStartAddress?.trim() || "";
  const smartOriginReady = smartOriginMode === "current"
    || (smartOriginMode === "last" && Boolean(lastCompleted))
    || (smartOriginMode === "profile" && Boolean(profileStartAddress))
    || (smartOriginMode === "manual" && smartRouteAddress.trim().length >= 3);
  const smartOriginSummary = smartOriginMode === "current"
    ? "Use this browser's current location"
    : smartOriginMode === "last"
      ? lastCompleted?.address || "No completed house is available"
      : smartOriginMode === "profile"
        ? profileStartAddress || "No route start address is saved in this Employee profile"
        : smartRouteAddress.trim() || "Type a starting address";

  const normalizedQuery = query.trim().toLowerCase();
  const employeeJobs = useMemo(() => {
    if (!employee) return [];
    return jobs.filter(item =>
      Boolean(item.canonicalCrewId)
      && item.canonicalCrewId === employee.crewId);
  }, [jobs, employee?.crewId]);
  const visibleJobs = useMemo(() => employeeJobs
    .filter(item =>
      !normalizedQuery
      || `${item.name} ${item.address} ${item.service}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) =>
      (left.nextVisitDate || "9999").localeCompare(right.nextVisitDate || "9999")
      || left.address.localeCompare(right.address)),
  [employeeJobs, normalizedQuery]);

  const selectedHomes = useMemo(
    () => employeeJobs.filter(item => selected.has(canonicalJobId(item))),
    [employeeJobs, selected],
  );

  const resetPreview = useCallback(() => {
    setPreview([]);
    setRemoved([]);
    setOrigin(null);
    setLockedJobIds([]);
    setMetrics({ distanceMeters: null, durationSeconds: null });
  }, []);

  function occurrenceLabel(home: RouteLead) {
    const occurrence = occurrencesOnDate.get(canonicalJobId(home));
    const status = routeStatus(occurrence);
    if (status === "completed") return "Esta casa já foi concluída hoje";
    if (status === "in_progress") return "In progress — blocked";
    if (status === "missed") return "Needs Reschedule";
    if (status === "scheduled") {
      return currentRoute.some(item => canonicalJobId(item) === canonicalJobId(home))
        ? "On this route"
        : "Move existing Visit";
    }
    const missed = latestMissedByJob.get(canonicalJobId(home));
    if (missed && missed.scheduledDate !== date) {
      return `Needs Reschedule · ${missed.scheduledDate}`;
    }
    return home.canonicalCrewId ? "Assigned Job" : "Available Job";
  }

  function toggleJob(home: RouteLead) {
    const id = canonicalJobId(home);
    const occurrence = occurrencesOnDate.get(id);
    const status = routeStatus(occurrence);

    if (status === "completed") {
      setReopenCandidate(occurrence || home);
      setReopenReason("");
      setReopenConfirmation("");
      setMessage("Esta casa já foi concluída hoje. Reopen is separate, audited and requires a strong confirmation.");
      return;
    }
    if (status === "in_progress") {
      setMessage("This house is in progress and cannot be selected, previewed, published or moved.");
      return;
    }
    if (status === "missed") {
      setMessage("Needs Reschedule: choose a new date so the same Visit can be moved.");
      return;
    }
    if (status === "scheduled"
        && currentRoute.some(item => canonicalJobId(item) === id)) {
      setMessage("This scheduled Visit is already on the selected Employee route.");
      return;
    }

    setSelectedJobIds(current =>
      current.includes(id)
        ? current.filter(value => value !== id)
        : [...current, id]);
    setRecommendations([]);
    resetPreview();
  }

  function changeEmployee(next: string) {
    setEmployeeId(next);
    setSmartOriginMode("current");
    setSmartRouteAddress("");
    setManualOriginPoint(null);
    setManualOrderOpen(true);
    setSelectedJobIds([]);
    setRecommendations([]);
    resetPreview();
  }

  function selectAllVisible() {
    const selectable = visibleJobs
      .filter(home => {
        const id = canonicalJobId(home);
        const status = routeStatus(occurrencesOnDate.get(id));
        return !["completed", "in_progress", "missed"].includes(status)
          && !(status === "scheduled"
            && currentRoute.some(item => canonicalJobId(item) === id));
      })
      .map(canonicalJobId);
    setSelectedJobIds(selectable);
    setRecommendations([]);
    resetPreview();
    setMessage(selectable.length
      ? `${selectable.length} ${employee?.name || "Employee"} contracts selected.`
      : "No selectable contracts are available for this Employee and date.");
  }

  function changeDate(next: string) {
    setDate(next);
    setManualOrderOpen(true);
    setRecommendations([]);
    resetPreview();
  }

  async function recommend() {
    if (!selectedHomes.length) {
      setMessage("Select at least one house for the Advisor to place.");
      return;
    }

    setBusy(true);
    setMessage("Comparing proximity, workload, capacity, due date and Employee continuity...");
    try {
      const days = new Set(planningDates(date, 7));
      const locatedEmployees = await Promise.all(employees.map(async worker => ({
        id: worker.id,
        employeeId: worker.employeeId,
        crewId: worker.crewId,
        name: worker.name,
        dailyCapacity: worker.dailyCapacity,
        start: worker.routeStartAddress
          ? await geocode(worker.routeStartAddress).catch(() => null)
          : null,
      })));
      const locatedHomes = await Promise.all(selectedHomes.map(async home => {
        const mapped = await locate(home);
        return {
          id: canonicalJobId(home),
          crewId: home.canonicalCrewId,
          nextVisitDate: home.nextVisitDate,
          point: {
            latitude: Number(mapped.latitude),
            longitude: Number(mapped.longitude),
          },
        };
      }));
      const planningVisits = visits.filter(item => item.scheduledDate && days.has(item.scheduledDate));
      const locatedVisits = await Promise.all(planningVisits.map(async visit => {
        const mapped = await locate(visit).catch(() => null);
        return {
          jobId: canonicalJobId(visit),
          date: visit.scheduledDate || date,
          employeeId: visit.canonicalEmployeeId,
          crewId: visit.canonicalCrewId,
          status: visit.canonicalVisitStatus,
          point: mapped
            ? { latitude: Number(mapped.latitude), longitude: Number(mapped.longitude) }
            : null,
        };
      }));

      const result = recommendRoutePlacements({
        employees: locatedEmployees,
        homes: locatedHomes,
        visits: locatedVisits,
        startDate: date,
        days: 7,
      });

      setRecommendations(result.slice(0, 6));
      setMessage(result.length
        ? "Suggestions are ready. The Admin can choose another Employee, another date or ignore every recommendation."
        : "No Employee has enough configured capacity in the next seven days.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route recommendations could not be calculated.");
    } finally {
      setBusy(false);
    }
  }

  function applyRecommendation(item: RouteAdvisorRecommendation) {
    setEmployeeId(item.employeeId);
    setDate(item.date);
    resetPreview();
    setMessage(`${item.employeeName} on ${item.date} is only a suggestion. Review and change everything before publishing.`);
  }

  function selectSmartOrigin(mode: SmartOriginMode) {
    setSmartOriginMode(mode);
    setOrigin(null);
    if (mode !== "manual") setManualOriginPoint(null);
    if (mode === "last" && !lastCompleted) {
      setMessage("No completed house is available for this Employee and date.");
    } else if (mode === "profile" && !profileStartAddress) {
      setMessage("Save a route start address in the Employee profile before using this option.");
    } else {
      setMessage("");
    }
  }

  async function resolveSmartOrigin(): Promise<Origin> {
    if (smartOriginMode === "current") {
      if (!navigator.geolocation) throw new Error("Current location is not available in this browser.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12_000,
          maximumAge: 30_000,
        }));
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        label: "Current location",
      };
    }

    if (smartOriginMode === "last") {
      if (!lastCompleted) throw new Error("No completed house is available for this Employee and date.");
      if (Number.isFinite(lastCompleted.latitude) && Number.isFinite(lastCompleted.longitude)) {
        return {
          latitude: Number(lastCompleted.latitude),
          longitude: Number(lastCompleted.longitude),
          label: lastCompleted.address,
        };
      }
      const point = await geocode(lastCompleted.address);
      return { ...point, label: lastCompleted.address };
    }

    if (smartOriginMode === "profile") {
      if (!profileStartAddress) throw new Error("This Employee profile has no saved route start address.");
      const point = await geocode(profileStartAddress);
      return { ...point, label: profileStartAddress };
    }

    const manualAddress = smartRouteAddress.trim();
    if (!manualAddress) throw new Error("Enter a valid manual starting address.");
    if (manualOriginPoint && manualOriginPoint.label === manualAddress) return manualOriginPoint;
    const point = await geocode(manualAddress);
    return { ...point, label: manualAddress };
  }

  async function generatePreview() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!smartOriginReady) {
      setMessage("Choose an available Smart Route starting point.");
      return;
    }
    if (currentRoute.some(item => routeStatus(item) === "in_progress")) {
      setMessage("An in-progress Visit blocks route preview and publication for this Employee/date.");
      return;
    }

    const selectedConflict = selectedHomes
      .map(home => ({ home, occurrence: occurrencesOnDate.get(canonicalJobId(home)) }))
      .find(item => ["completed", "in_progress", "missed"].includes(routeStatus(item.occurrence)));
    if (selectedConflict?.occurrence) {
      const status = routeStatus(selectedConflict.occurrence);
      setMessage(status === "completed"
        ? "Esta casa já foi concluída hoje"
        : status === "missed"
          ? "Needs Reschedule: choose a new date."
          : "This house is currently in progress.");
      return;
    }

    setBusy(true);
    setMessage("Optimizing the initial suggestion and preparing manual route controls...");
    try {
      const locked = currentRoute.filter(item => routeStatus(item) === "completed");
      const mutableCurrent = currentRoute.filter(item => routeStatus(item) === "scheduled");
      const selectedCanonical = selectedHomes.map(home => {
        const id = canonicalJobId(home);
        const targetOccurrence = occurrencesOnDate.get(id);
        if (targetOccurrence && routeStatus(targetOccurrence) === "scheduled") return targetOccurrence;
        const missed = latestMissedByJob.get(id);
        if (missed && missed.scheduledDate !== date) return missed;
        return home;
      });
      const combinedByJob = new Map<string, RouteLead>();
      for (const home of [...locked, ...mutableCurrent, ...selectedCanonical]) {
        combinedByJob.set(canonicalJobId(home), home);
      }
      const combined = [...combinedByJob.values()];

      if (!combined.length) {
        setMessage("Select houses or keep at least one existing scheduled stop.");
        return;
      }
      if (combined.length > employee.dailyCapacity) {
        setMessage(`${employee.name}'s profile allows ${employee.dailyCapacity} houses per day. Remove ${combined.length - employee.dailyCapacity}.`);
        return;
      }

      const start = await resolveSmartOrigin();
      const mapped = await Promise.all(combined.map(locate));
      const mutable = mapped.filter(home => !locked.some(item => canonicalJobId(item) === canonicalJobId(home)));
      let optimizedMutable = [...mutable];

      if (mutable.length > 1) {
        const response = await fetch("/api/map/optimize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            start: [start.longitude, start.latitude],
            coordinates: mutable.map(home => [
              Number(home.longitude),
              Number(home.latitude),
            ]),
          }),
        });
        if (response.ok) {
          const result = await response.json() as { order: number[] };
          optimizedMutable = result.order.map(index => mutable[index]).filter(Boolean);
        }
      }

      const lockedByPosition = new Map<number, RouteLead>();
      for (const home of locked) {
        const mappedLocked = mapped.find(item => canonicalJobId(item) === canonicalJobId(home));
        if (mappedLocked && home.routeOrder) lockedByPosition.set(home.routeOrder - 1, mappedLocked);
      }

      const final: RouteLead[] = [];
      let mutableIndex = 0;
      for (let index = 0; index < mapped.length; index++) {
        const lockedHome = lockedByPosition.get(index);
        final.push(lockedHome || optimizedMutable[mutableIndex++]);
      }
      while (mutableIndex < optimizedMutable.length) final.push(optimizedMutable[mutableIndex++]);

      setOrigin(start);
      setLockedJobIds(locked.map(canonicalJobId));
      setPreview(normalizeOrder(final.filter(Boolean)));
      setRemoved([]);
      setManualOrderOpen(true);
      setMessage("Smart Route ready from the selected starting point. Manual changes remain available below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route preview could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function applySmartRoute() {
    if (!employee) {
      setMessage("Choose an Employee.");
      return;
    }
    if (!smartOriginReady) {
      setMessage("Choose an available Smart Route starting point.");
      return;
    }
    if (!preview.length) {
      await generatePreview();
      return;
    }
    if (preview.some(item => routeStatus(item) === "in_progress")) {
      setMessage("An in-progress Visit blocks Smart Route recalculation.");
      return;
    }

    setBusy(true);
    setMessage("Calculating the most efficient order from the selected starting point...");
    try {
      const start = await resolveSmartOrigin();
      const mapped = await Promise.all(preview.map(locate));
      const mutable = mapped.filter(home => !locked.has(canonicalJobId(home)));
      let optimizedMutable = [...mutable];

      if (mutable.length > 1) {
        const response = await fetch("/api/map/optimize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            start: [start.longitude, start.latitude],
            coordinates: mutable.map(home => [
              Number(home.longitude),
              Number(home.latitude),
            ]),
          }),
        });
        if (!response.ok) throw new Error("Smart Route optimization could not be calculated.");
        const result = await response.json() as { order: number[] };
        optimizedMutable = result.order.map(index => mutable[index]).filter(Boolean);
      }

      setOrigin(start);
      setPreview(reconstructMutable(optimizedMutable));
      setRemoved([]);
      setManualOrderOpen(true);
      setMessage("Smart Route recalculated. Review the order below, make manual changes if needed, then publish.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Smart Route could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  const locked = useMemo(() => new Set(lockedJobIds), [lockedJobIds]);
  const lastLockedIndex = useMemo(() => {
    let result = -1;
    preview.forEach((home, index) => {
      if (locked.has(canonicalJobId(home))) result = Math.max(result, index);
    });
    return result;
  }, [preview, locked]);

  const reconstructMutable = useCallback((mutableItems: RouteLead[]) => {
    let mutableIndex = 0;
    return normalizeOrder(preview.map(home =>
      locked.has(canonicalJobId(home))
        ? home
        : mutableItems[mutableIndex++]));
  }, [preview, locked]);

  function moveBy(home: RouteLead, direction: -1 | 1) {
    const id = canonicalJobId(home);
    if (locked.has(id)) return;
    const mutable = preview.filter(item => !locked.has(canonicalJobId(item)));
    const index = mutable.findIndex(item => canonicalJobId(item) === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= mutable.length) return;
    [mutable[index], mutable[target]] = [mutable[target], mutable[index]];
    setPreview(reconstructMutable(mutable));
    setMessage(`${home.name} moved. Canonical route numbers and map metrics were recalculated.`);
  }

  function moveToPosition(home: RouteLead, requested: number) {
    const id = canonicalJobId(home);
    if (locked.has(id) || !Number.isFinite(requested)) return;
    const mutableSlots = preview
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !locked.has(canonicalJobId(item)));
    const mutable = mutableSlots.map(({ item }) => item);
    const current = mutable.findIndex(item => canonicalJobId(item) === id);
    if (current < 0) return;

    const nearestSlot = mutableSlots.reduce((best, slot, ordinal) => {
      const distance = Math.abs(slot.index + 1 - requested);
      return distance < best.distance ? { ordinal, distance } : best;
    }, { ordinal: 0, distance: Number.POSITIVE_INFINITY }).ordinal;

    const [item] = mutable.splice(current, 1);
    mutable.splice(nearestSlot, 0, item);
    setPreview(reconstructMutable(mutable));
    setMessage(`${home.name} moved to the nearest available unlocked position.`);
  }

  const removeFromPreview = useCallback((home: RouteLead) => {
    const id = canonicalJobId(home);
    const index = preview.findIndex(item => canonicalJobId(item) === id);
    if (index < 0 || locked.has(id)) return;
    if (index < lastLockedIndex) {
      setMessage("This stop is before a completed locked house. Move it after the completed section before removing it.");
      return;
    }

    setRemoved(current => [
      ...current.filter(item => canonicalJobId(item.home) !== id),
      { home, index },
    ]);
    setPreview(current =>
      normalizeOrder(current.filter(item => canonicalJobId(item) !== id)));
    setSelectedJobIds(current => current.filter(value => value !== id));
    setMessage(`${home.name} removed from the preview. Use Restore before publishing if needed.`);
  }, [preview, locked, lastLockedIndex]);

  function restoreRemoved(item: RemovedStop) {
    const index = Math.min(item.index, preview.length);
    const next = [...preview];
    next.splice(index, 0, item.home);
    setPreview(normalizeOrder(next));
    setRemoved(current =>
      current.filter(removedItem =>
        canonicalJobId(removedItem.home) !== canonicalJobId(item.home)));
    setMessage(`${item.home.name} restored to the route preview.`);
  }

  async function publish() {
    if (!employee || !preview.length) return;
    if (!origin) {
      setMessage("Generate the Smart Route start point before publishing.");
      return;
    }

    setBusy(true);
    setMessage("Publishing the reviewed canonical route in one database transaction...");
    try {
      const token = await accessToken();
      const sourceVisitIds = preview
        .filter(home =>
          routeStatus(home) === "missed"
          && home.scheduledDate !== date
          && Boolean(home.canonicalVisitId))
        .map(home => home.canonicalVisitId as string);

      const response = await fetch("/api/admin/route-advisor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "publish",
          employeeId: employee.employeeId || employee.id,
          crewId: employee.crewId,
          routeDate: date,
          orderedJobIds: preview.map(canonicalJobId),
          sourceVisitIds,
          origin: {
            label: origin.label,
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The route could not be published.");

      const routeVersion = Number(result.routeVersion || result.routeVersions?.[result.routeId] || 0);
      setMessage(`${result.count} houses published for ${employee.name} on ${date}${routeVersion ? ` as canonical route v${routeVersion}` : ""}. Admin and Employee web/mobile update automatically.`);
      setSelectedJobIds([]);
      setRecommendations([]);
      resetPreview();
      window.dispatchEvent(new CustomEvent("damasio:canonical-route-updated", { detail: { routeId: result.routeId } }));
      if (typeof BroadcastChannel !== "undefined") {
        const broadcast = new BroadcastChannel("damasio-canonical-route");
        broadcast.postMessage({ routeId: result.routeId, routeVersion });
        broadcast.close();
      }
      await refresh(true);
      if (result.routeId === currentRouteId) await refreshLiveRoute();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The route could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function reopenCompleted() {
    if (!reopenCandidate || busy) return;
    if (reopenConfirmation !== "REOPEN" || reopenReason.trim().length < 5) return;

    setBusy(true);
    setMessage("Checking Task, feedback, charge, transfer and refund dependencies...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/route-advisor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "reopen",
          visitId: reopenCandidate.canonicalVisitId || reopenCandidate.id,
          reopenReason,
          confirmReopen: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The completed Visit could not be reopened.");

      setMessage(`${reopenCandidate.name} was reopened using the same canonical Visit. The reason and actor were audited.`);
      setReopenCandidate(null);
      setReopenReason("");
      setReopenConfirmation("");
      resetPreview();
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The completed Visit could not be reopened.");
    } finally {
      setBusy(false);
    }
  }

  const handleMetrics = useCallback((next: RoutePreviewMetrics) => {
    setMetrics(next);
  }, []);

  const smartRoutePanel = <section className="advisor-smart-route">
    <div className="advisor-smart-header">
      <span>SMART ROUTE</span>
      <h3>Choose where the route starts.</h3>
      <p>Use the same four starting options available on mobile. The selected point and optimized order are saved together in the canonical Route.</p>
    </div>

    <div className="advisor-origin-modes" role="group" aria-label="Smart Route starting point">
      <button
        type="button"
        className={smartOriginMode === "current" ? "active" : ""}
        aria-pressed={smartOriginMode === "current"}
        onClick={() => selectSmartOrigin("current")}
      >
        <b>Current location</b>
        <small>Browser GPS</small>
      </button>
      <button
        type="button"
        className={smartOriginMode === "last" ? "active" : ""}
        aria-pressed={smartOriginMode === "last"}
        disabled={!lastCompleted}
        onClick={() => selectSmartOrigin("last")}
      >
        <b>Last completed house</b>
        <small>{lastCompleted ? "Latest finished Visit" : "Unavailable"}</small>
      </button>
      <button
        type="button"
        className={smartOriginMode === "manual" ? "active" : ""}
        aria-pressed={smartOriginMode === "manual"}
        onClick={() => selectSmartOrigin("manual")}
      >
        <b>Manual address</b>
        <small>Search or type</small>
      </button>
      <button
        type="button"
        className={smartOriginMode === "profile" ? "active" : ""}
        aria-pressed={smartOriginMode === "profile"}
        disabled={!profileStartAddress}
        onClick={() => selectSmartOrigin("profile")}
      >
        <b>Profile address</b>
        <small>{profileStartAddress ? "Saved previously" : "Not configured"}</small>
      </button>
    </div>

    <div className="advisor-origin-row">
      <div className="advisor-origin-detail">
        {smartOriginMode === "manual" ? <label>
          <span>Manual start address</span>
          <AddressAutocomplete
            value={smartRouteAddress}
            onChange={value => {
              setSmartRouteAddress(value);
              setManualOriginPoint(null);
              setOrigin(null);
            }}
            onSelect={suggestion => {
              setSmartRouteAddress(suggestion.label);
              setManualOriginPoint({
                label: suggestion.label,
                latitude: suggestion.latitude,
                longitude: suggestion.longitude,
              });
              setOrigin(null);
            }}
            placeholder="Start typing the address..."
            ariaLabel="Smart Route manual start address"
          />
        </label> : <div className="advisor-origin-summary">
          <span>Selected start</span>
          <strong>{smartOriginSummary}</strong>
        </div>}
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !employee || !smartOriginReady}
        onClick={() => void applySmartRoute()}
      >
        {busy ? "Calculating..." : preview.length ? "Recalculate Smart Route" : "Generate Smart Route"}
      </button>
    </div>
  </section>;

  return <section className="advisor-shell">
    <header className="advisor-hero">
      <div>
        <span>ROUTE ADVISOR</span>
        <h2>Create, add, reorder or remove houses.</h2>
        <p>The Advisor edits the same versioned canonical Route used by Admin and Employee on web and mobile. Nothing publishes automatically.</p>
      </div>
      <div className="advisor-guard">
        <strong>Admin approval required</strong>
        <small>Employee, date, houses and order remain editable.</small>
      </div>
    </header>

    <section className="advisor-controls">
      <label>
        <span>Employee</span>
        <select value={employeeId} onChange={(event: { target: { value: string } }) => changeEmployee(event.target.value)}>
          <option value="">Select Employee</option>
          {employees.map(item =>
            <option key={item.id} value={item.id}>{item.name} · {item.dailyCapacity}/day</option>)}
        </select>
      </label>
      <label>
        <span>Route date · America/Toronto</span>
        <input type="date" value={date} onChange={(event: { target: { value: string } }) => changeDate(event.target.value)} />
      </label>
      <label>
        <span>Search houses</span>
        <input
          value={query}
          onChange={(event: { target: { value: string } }) => setQuery(event.target.value)}
          placeholder="Customer, address or service"
        />
      </label>
      <button
        type="button"
        className="btn btn-outline"
        disabled={loading || busy}
        onClick={() => void refresh()}
      >
        {loading ? "Loading..." : "Refresh"}
      </button>
    </section>

    {message && <div className="desktop-route-message">{message}</div>}

    {reopenCandidate && <section className="advisor-reopen">
      <div>
        <span>STRONG CONFIRMATION</span>
        <h3>Reopen completed Visit for {reopenCandidate.name}?</h3>
        <p>The same Visit ID is preserved. Reopen is blocked if Task, feedback, charge, transfer or refund dependencies exist.</p>
      </div>
      <label>
        <span>Mandatory reason</span>
        <textarea
          value={reopenReason}
          onChange={(event: { target: { value: string } }) => setReopenReason(event.target.value)}
          placeholder="Explain why completed work must return to Scheduled."
        />
      </label>
      <label>
        <span>Type REOPEN</span>
        <input
          value={reopenConfirmation}
          onChange={(event: { target: { value: string } }) => setReopenConfirmation(event.target.value.toUpperCase())}
          placeholder="REOPEN"
        />
      </label>
      <div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setReopenCandidate(null);
            setReopenReason("");
            setReopenConfirmation("");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || reopenReason.trim().length < 5 || reopenConfirmation !== "REOPEN"}
          onClick={() => void reopenCompleted()}
        >
          {busy ? "Checking…" : "Reopen same Visit"}
        </button>
      </div>
    </section>}

    <section className="advisor-layout">
      <aside className="advisor-house-picker">
        <header>
          <div>
            <strong>Houses to place</strong>
            <small>{employeeJobs.length} contracts · {selectedJobIds.length} selected · route {currentRoute.length}/{employee?.dailyCapacity || 0}</small>
          </div>
          <div className="advisor-picker-actions">
            <button
              type="button"
              onClick={() => {
                setSelectedJobIds([]);
                resetPreview();
              }}
            >
              Clear
            </button>
            <button type="button" onClick={selectAllVisible}>
              Select all
            </button>
          </div>
        </header>
        <div className="advisor-house-list">
          {visibleJobs.map((home, index) => {
            const id = canonicalJobId(home);
            const active = selected.has(id);
            const occurrence = occurrencesOnDate.get(id);
            const status = routeStatus(occurrence);
            const blocked = ["completed", "in_progress", "missed"].includes(status)
              || (status === "scheduled"
                && currentRoute.some(item => canonicalJobId(item) === id));
            return <button
              type="button"
              key={id}
              className={`${active ? "selected" : ""} ${blocked ? "blocked" : ""}`}
              onClick={() => toggleJob(home)}
            >
              <b>{index + 1}</b>
              <span>
                <strong>{firstName(home.name)} — {home.address}</strong>
                <small>{home.service} · due {home.nextVisitDate || "not set"}</small>
              </span>
              <em>{occurrenceLabel(home)}</em>
            </button>;
          })}
          {!visibleJobs.length && <div className="desktop-route-empty"><strong>No matching active Jobs.</strong></div>}
        </div>
        <button
          type="button"
          className="btn btn-primary advisor-recommend"
          disabled={busy || !selectedHomes.length}
          onClick={() => void recommend()}
        >
          {busy ? "Analyzing..." : `Recommend Employee & day (${selectedHomes.length})`}
        </button>
      </aside>

      <main className="advisor-main">
        {recommendations.length > 0 && <section className="advisor-recommendations">
          <header>
            <strong>Best regional fits</strong>
            <span>Suggestions only — manual choice remains available.</span>
          </header>
          <div>
            {recommendations.map((item, index) =>
              <button
                type="button"
                key={`${item.employeeId}-${item.date}`}
                onClick={() => applyRecommendation(item)}
              >
                <b>#{index + 1}</b>
                <span>
                  <strong>{item.employeeName} · {item.date}</strong>
                  <small>{item.existingStops + item.selectedStops}/{item.capacity} capacity · +{item.estimatedExtraKm} km</small>
                  <em>{item.reasons.join(" · ")}</em>
                </span>
                <i>{item.score}%</i>
              </button>)}
          </div>
        </section>}

        {!preview.length ? <>
          <section className="advisor-empty-preview">
            <div>
              <span>MANUAL PREVIEW</span>
              <h3>{employee ? `${employee.name} · ${date}` : "Choose an Employee"}</h3>
              <p>{employee
                ? `Capacity used ${currentRoute.length}/${employee.dailyCapacity}. Open the editor or define a start address below.`
                : "Choose any valid Employee and date."}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !employee}
              onClick={() => void generatePreview()}
            >
              {busy ? "Calculating..." : currentRoute.length ? "Edit current canonical route" : "Create route preview"}
            </button>
          </section>
          {smartRoutePanel}
        </> : <>
          <section className="advisor-impact">
            <div><span>Capacity used</span><strong>{preview.length}/{employee?.dailyCapacity || preview.length}</strong></div>
            <div><span>Road distance</span><strong>{formatDistance(metrics.distanceMeters)}</strong></div>
            <div><span>Driving estimate</span><strong>{formatDuration(metrics.durationSeconds)}</strong></div>
            <div><span>Admin decision</span><strong>Manual order</strong></div>
          </section>

          {smartRoutePanel}

          <section className="advisor-manual-order">
            <header>
              <div>
                <span>MANUAL ROUTE ORDER</span>
                <h3>Map and canonical route_order stay synchronized.</h3>
              </div>
              <div className="advisor-manual-summary">
                <small>Completed positions are locked. Pending houses support Up, Down and direct Position.</small>
                <button
                  type="button"
                  aria-expanded={manualOrderOpen}
                  aria-controls="advisor-manual-route-list"
                  onClick={() => setManualOrderOpen(current => !current)}
                >
                  <i aria-hidden="true">{manualOrderOpen ? "▲" : "▼"}</i>
                  {manualOrderOpen ? "Collapse" : "Expand"}
                </button>
              </div>
            </header>
            {manualOrderOpen && <div id="advisor-manual-route-list">
              {preview.map((home, index) => {
                const id = canonicalJobId(home);
                const isLocked = locked.has(id);
                return <article key={`${id}-${index}`}>
                  <b>{index + 1}</b>
                  <span>
                    <strong>{home.name}</strong>
                    <small>{home.address} · {routeStatus(home) === "missed" ? "Needs Reschedule" : home.service}</small>
                  </span>
                  <div>
                    <button type="button" disabled={isLocked} onClick={() => moveBy(home, -1)} aria-label={`Move ${home.name} up`}>↑</button>
                    <button type="button" disabled={isLocked} onClick={() => moveBy(home, 1)} aria-label={`Move ${home.name} down`}>↓</button>
                    <label>
                      <span>Position</span>
                      <input
                        type="number"
                        min={1}
                        max={preview.length}
                        value={index + 1}
                        disabled={isLocked}
                        onChange={(event: { target: { value: string } }) => moveToPosition(home, Number(event.target.value))}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => removeFromPreview(home)}
                    >
                      {isLocked ? "Completed" : "Remove"}
                    </button>
                  </div>
                </article>;
              })}
            </div>}
          </section>

          {removed.length > 0 && <section className="advisor-removed">
            <header><strong>Removed from preview</strong><span>Restore before publishing when needed.</span></header>
            <div>{removed.map(item =>
              <button
                type="button"
                key={canonicalJobId(item.home)}
                onClick={() => restoreRemoved(item)}
              >
                <span><strong>{item.home.name}</strong><small>{item.home.address}</small></span>
                <em>Restore</em>
              </button>)}</div>
          </section>}

          <InteractiveRoutePreviewMap
            route={preview}
            origin={origin}
            capacity={employee?.dailyCapacity || preview.length}
            lockedJobIds={lockedJobIds}
            onRemove={removeFromPreview}
            onMetricsChange={handleMetrics}
          />

          <section className="advisor-publish-bar">
            <div>
              <strong>{preview.length}/{employee?.dailyCapacity || preview.length} houses ready</strong>
              <span>Publish uses one transaction and preserves the canonical Visit when moving or rescheduling.</span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !preview.length}
              onClick={() => void publish()}
            >
              {busy ? "Publishing..." : "Confirm & publish route"}
            </button>
          </section>
        </>}
      </main>
    </section>

    <style jsx global>{`
      .advisor-shell{display:grid;gap:18px}.advisor-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:26px;border-radius:24px;background:linear-gradient(135deg,#082f23,#0d6b47);color:#fff}.advisor-hero span,.advisor-manual-order header span,.advisor-smart-header>span,.advisor-reopen>div>span{color:#9ce3b9;font-size:10px;font-weight:950;letter-spacing:.13em}.advisor-hero h2{margin:7px 0 6px;font-size:34px;letter-spacing:-.04em}.advisor-hero p{max-width:760px;margin:0;color:rgba(255,255,255,.7)}.advisor-guard{min-width:230px;padding:14px 16px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:rgba(255,255,255,.09)}.advisor-guard strong,.advisor-guard small{display:block}.advisor-guard small{margin-top:4px;color:rgba(255,255,255,.65)}
      .advisor-controls{display:grid;grid-template-columns:1fr 245px 1fr auto;gap:12px;align-items:end;padding:16px;border:1px solid #dbe7e1;border-radius:20px;background:#fff}.advisor-controls label,.advisor-reopen label{display:grid;gap:6px}.advisor-controls label>span,.advisor-reopen label>span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.advisor-controls input,.advisor-controls select,.advisor-reopen input,.advisor-reopen textarea{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff;color:#173a2c}.advisor-reopen textarea{min-height:88px;padding:12px;resize:vertical}
      .advisor-reopen{display:grid;grid-template-columns:minmax(260px,1.2fr) minmax(250px,1fr) 180px auto;gap:14px;align-items:end;padding:18px;border:2px solid #dc2626;border-radius:20px;background:#fff7f7}.advisor-reopen h3{margin:5px 0}.advisor-reopen p{margin:0;color:#6b7280}.advisor-reopen>div:last-child{display:flex;gap:8px}
      .advisor-layout{display:grid;grid-template-columns:minmax(330px,.72fr) minmax(0,1.45fr);gap:16px;align-items:start}.advisor-house-picker,.advisor-main>section,.advisor-recommendations{border:1px solid #dbe7e1;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(19,52,39,.05)}.advisor-house-picker{overflow:hidden;position:sticky;top:16px}.advisor-house-picker>header,.advisor-recommendations>header,.advisor-removed>header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px;border-bottom:1px solid #e7eeea}.advisor-house-picker header strong,.advisor-house-picker header small{display:block}.advisor-house-picker header small{margin-top:3px;color:#64748b}.advisor-house-picker header button{border:0;background:transparent;color:#0b7655;font-weight:900;cursor:pointer}.advisor-picker-actions{display:grid;gap:4px;text-align:right}.advisor-house-list{max-height:610px;overflow:auto;padding:10px}.advisor-house-list>button{display:grid;grid-template-columns:34px minmax(0,1fr) minmax(95px,auto);gap:10px;align-items:center;width:100%;padding:12px;border:1px solid transparent;border-radius:14px;background:transparent;text-align:left;cursor:pointer}.advisor-house-list>button:hover{background:#f6faf8}.advisor-house-list>button.selected{border-color:#0b7655;background:#edf8f2}.advisor-house-list>button.blocked{opacity:.72}.advisor-house-list b{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#eaf2ee;color:#0b684c}.advisor-house-list span strong,.advisor-house-list span small{display:block}.advisor-house-list span strong{font-size:12px}.advisor-house-list span small{margin-top:4px;color:#64748b;font-size:10px}.advisor-house-list em{font-style:normal;text-align:right;font-size:9px;font-weight:900;color:#0b7655}.advisor-recommend{width:calc(100% - 20px);margin:0 10px 10px;min-height:48px}
      .advisor-main{display:grid;gap:14px}.advisor-recommendations{overflow:hidden}.advisor-recommendations>header span{color:#64748b;font-size:12px}.advisor-recommendations>div{display:grid;gap:8px;padding:10px}.advisor-recommendations button{display:grid;grid-template-columns:34px minmax(0,1fr) 54px;gap:10px;align-items:center;padding:13px;border:1px solid #e1eae5;border-radius:14px;background:#fff;text-align:left;cursor:pointer}.advisor-recommendations button:hover{border-color:#0b7655;background:#f4faf7}.advisor-recommendations button>b{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#0b7655;color:#fff}.advisor-recommendations button span strong,.advisor-recommendations button span small,.advisor-recommendations button span em{display:block}.advisor-recommendations button span small{margin-top:3px;color:#64748b}.advisor-recommendations button span em{margin-top:4px;color:#4f665a;font-size:10px;font-style:normal}.advisor-recommendations button>i{font-style:normal;font-weight:950;color:#0b7655}
      .advisor-empty-preview{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:28px}.advisor-empty-preview span{color:#0b7655;font-size:10px;font-weight:950;letter-spacing:.1em}.advisor-empty-preview h3{margin:6px 0;font-size:27px}.advisor-empty-preview p{margin:0;color:#64748b}.advisor-impact{display:grid!important;grid-template-columns:repeat(4,1fr);gap:1px;overflow:hidden;padding:0!important}.advisor-impact div{padding:14px 16px;background:#fff}.advisor-impact span,.advisor-impact strong{display:block}.advisor-impact span{color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase}.advisor-impact strong{margin-top:4px;color:#173a2c}
      .advisor-smart-route{display:grid!important;gap:14px;padding:18px}.advisor-smart-header h3{margin:5px 0 4px;color:#173a2c}.advisor-smart-header p{margin:0;color:#64748b;font-size:12px;line-height:1.45}.advisor-origin-modes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.advisor-origin-modes>button{display:grid;gap:3px;min-height:62px;border:1px solid #d5e1db;border-radius:13px;background:#fbfdfc;padding:10px 11px;color:#173a2c;text-align:left;cursor:pointer}.advisor-origin-modes>button:hover:not(:disabled){border-color:#69a88d;background:#f4faf7}.advisor-origin-modes>button.active{border-color:#0b7655;background:#eaf7f0;box-shadow:inset 0 0 0 1px #0b7655}.advisor-origin-modes>button:disabled{cursor:not-allowed;opacity:.5}.advisor-origin-modes b,.advisor-origin-modes small{display:block}.advisor-origin-modes b{font-size:11px}.advisor-origin-modes small{color:#64748b;font-size:9px}.advisor-origin-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}.advisor-origin-detail label{display:grid;gap:6px}.advisor-origin-detail label>span,.advisor-origin-summary>span{color:#607168;font-size:10px;font-weight:900;text-transform:uppercase}.advisor-origin-summary{display:grid;gap:6px;min-height:48px;padding:10px 13px;border:1px solid #dbe7e1;border-radius:12px;background:#f8fbf9}.advisor-origin-summary strong{color:#173a2c;font-size:12px;line-height:1.3}.advisor-origin-detail .address-autocomplete{position:relative}.advisor-origin-detail .address-suggestions{z-index:45}.advisor-smart-route input{width:100%;min-height:48px;border:1px solid #cbdad2;border-radius:12px;padding:0 13px;background:#fff;color:#173a2c}.advisor-smart-route .btn{min-height:48px;white-space:nowrap}
      .advisor-manual-order{overflow:hidden}.advisor-manual-order>header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:16px;border-bottom:1px solid #e7eeea}.advisor-manual-order header span{color:#0b7655}.advisor-manual-order h3{margin:4px 0 0}.advisor-manual-summary{display:flex;align-items:center;justify-content:flex-end;gap:12px}.advisor-manual-order header small{max-width:390px;color:#64748b;text-align:right}.advisor-manual-summary>button{display:inline-flex;align-items:center;gap:7px;min-height:40px;border:1px solid #cbdad2;border-radius:10px;background:#fff;padding:0 12px;color:#173a2c;font-weight:900;cursor:pointer}.advisor-manual-summary>button i{color:#0b7655;font-size:10px;font-style:normal}.advisor-manual-order>div{display:grid}.advisor-manual-order article{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid #edf2ef}.advisor-manual-order article:last-child{border-bottom:0}.advisor-manual-order article>b{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#e9f1ed;color:#0b684c}.advisor-manual-order article>span strong,.advisor-manual-order article>span small{display:block}.advisor-manual-order article>span small{margin-top:3px;color:#64748b;font-size:10px}.advisor-manual-order article>div{display:flex;align-items:end;gap:6px}.advisor-manual-order article button{min-height:36px;border:1px solid #cbdad2;border-radius:9px;background:#fff;padding:0 10px;color:#173a2c;font-weight:900;cursor:pointer}.advisor-manual-order article button:disabled{cursor:not-allowed;opacity:.45}.advisor-manual-order article label{display:grid;gap:2px}.advisor-manual-order article label span{color:#64748b;font-size:8px;font-weight:900;text-transform:uppercase}.advisor-manual-order article input{width:70px;height:36px;border:1px solid #cbdad2;border-radius:9px;padding:0 7px}
      .advisor-removed{overflow:hidden}.advisor-removed>header span{color:#64748b;font-size:11px}.advisor-removed>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px}.advisor-removed button{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:11px;border:1px solid #e1eae5;border-radius:12px;background:#fff;text-align:left;cursor:pointer}.advisor-removed button span strong,.advisor-removed button span small{display:block}.advisor-removed button span small{margin-top:2px;color:#64748b;font-size:10px}.advisor-removed button em{font-style:normal;color:#0b7655;font-weight:950}
      .advisor-publish-bar{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:16px 18px}.advisor-publish-bar strong,.advisor-publish-bar span{display:block}.advisor-publish-bar span{margin-top:4px;color:#64748b;font-size:11px}
      @media(max-width:1150px){.advisor-reopen{grid-template-columns:1fr 1fr}.advisor-controls{grid-template-columns:1fr 1fr}.advisor-origin-modes{grid-template-columns:repeat(2,minmax(0,1fr))}.advisor-layout{grid-template-columns:1fr}.advisor-house-picker{position:static}.advisor-house-list{max-height:420px}}
      @media(max-width:760px){.advisor-hero,.advisor-empty-preview,.advisor-publish-bar,.advisor-manual-order>header{align-items:stretch;flex-direction:column}.advisor-controls,.advisor-reopen,.advisor-impact{grid-template-columns:1fr!important}.advisor-origin-row{grid-template-columns:1fr}.advisor-origin-modes{grid-template-columns:repeat(2,minmax(0,1fr))}.advisor-smart-route .btn{width:100%}.advisor-manual-summary{align-items:stretch;flex-direction:column}.advisor-manual-order header small{text-align:left}.advisor-hero h2{font-size:29px}.advisor-guard{min-width:0}.advisor-publish-bar .btn{width:100%}.advisor-manual-order article{grid-template-columns:34px 1fr}.advisor-manual-order article>div{grid-column:1/-1;flex-wrap:wrap}.advisor-removed>div{grid-template-columns:1fr}}
    `}</style>
  </section>;
}
