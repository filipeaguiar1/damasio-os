"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerDirectoryPagination, CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { getCustomerPropertyDirectoryPage } from "@/lib/services/customerPropertyService";

const emptyPagination: CustomerDirectoryPagination = {
  page: 1,
  pageSize: 50,
  total: 0,
  pageCount: 1,
  hasNext: false,
  hasPrevious: false,
};

export function useCustomerProperties(options: {
  query?: string;
  city?: string;
  pageSize?: number;
} = {}) {
  const [records, setRecords] = useState<CustomerPropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(options.query || "");
  const [city, setCity] = useState(options.city || "all");
  const [pagination, setPagination] = useState<CustomerDirectoryPagination>(emptyPagination);
  const [counts, setCounts] = useState({ customers: 0, properties: 0, pageJobs: 0 });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCustomerPropertyDirectoryPage({
        page,
        pageSize: options.pageSize || 50,
        query,
        city,
      });
      setRecords(result.records);
      setPagination(result.pagination);
      setCounts(result.counts);
      if (result.pagination.page !== page) setPage(result.pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, [page, options.pageSize, query, city]);

  useEffect(() => { setPage(1); }, [query, city]);
  useEffect(() => { void refresh(); }, [refresh]);

  const nextPage = useCallback(() => {
    if (pagination.hasNext) setPage(current => current + 1);
  }, [pagination.hasNext]);
  const previousPage = useCallback(() => {
    if (pagination.hasPrevious) setPage(current => Math.max(1, current - 1));
  }, [pagination.hasPrevious]);

  return {
    records,
    loading,
    error,
    refresh,
    page,
    setPage,
    query,
    setQuery,
    city,
    setCity,
    pagination,
    counts,
    nextPage,
    previousPage,
  };
}
