"use client";

import { useEffect, useRef, useState } from "react";
import {
  MOBILE_OPERATION_STATUS_EVENT,
  type MobileOperationStatus as OperationStatus,
} from "@/lib/mobile/mobileOperationStatus";
import styles from "./MobileOperationStatus.module.css";

export function MobileOperationStatus() {
  const [status, setStatus] = useState<OperationStatus | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    function clearTimer() {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
    }

    function onStatus(event: Event) {
      const detail = (event as CustomEvent<OperationStatus>).detail;
      clearTimer();

      if (!detail || detail.phase === "clear") {
        setStatus(null);
        return;
      }

      setStatus(detail);
      if (detail.phase !== "working") {
        timer.current = window.setTimeout(
          () => setStatus(null),
          detail.phase === "success" ? 2400 : 5200,
        );
      }
    }

    window.addEventListener(MOBILE_OPERATION_STATUS_EVENT, onStatus);
    return () => {
      clearTimer();
      window.removeEventListener(MOBILE_OPERATION_STATUS_EVENT, onStatus);
    };
  }, []);

  if (!status) return null;

  if (status.phase === "working") {
    return (
      <div
        className={styles.layer}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className={styles.card}>
          <span className={styles.spinner} aria-hidden="true" />
          <strong>{status.title || "Saving"}</strong>
          <p>{status.message || "Please keep this screen open."}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.result} ${status.phase === "success" ? styles.success : styles.error}`}
      role={status.phase === "error" ? "alert" : "status"}
      aria-live="assertive"
    >
      <strong>{status.title}</strong>
      <span>{status.message}</span>
    </div>
  );
}
