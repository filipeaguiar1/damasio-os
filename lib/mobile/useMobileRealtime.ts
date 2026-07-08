"use client";

import { useEffect, useRef } from "react";
import { DAMASIO_SYNC_EVENT } from "@/lib/storage";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function useMobileRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    try {
      const supabase = getSupabaseBrowserClient() as any;
      const channel = supabase
        .channel("damasio-mobile-live-sync")
        .on("postgres_changes", { event: "*", schema: "public" }, () => {
          if (!active) return;
          window.dispatchEvent(new Event(DAMASIO_SYNC_EVENT));
          onChangeRef.current();
        })
        .subscribe();
      return () => {
        active = false;
        try { supabase.removeChannel(channel); } catch {}
      };
    } catch {
      // Mobile app must never be blocked by realtime/Supabase issues.
      return;
    }
  }, []);
}
