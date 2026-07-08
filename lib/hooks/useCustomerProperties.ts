"use client";

import { useCallback, useEffect, useState } from "react";
import { CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { getCustomerPropertyDirectory } from "@/lib/services/customerPropertyService";

export function useCustomerProperties() {
  const [records, setRecords] = useState<CustomerPropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await getCustomerPropertyDirectory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { records, loading, error, refresh };
}
