"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PlatformRegistrationAction() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const locateModal = () => {
      const modal = document.querySelector<HTMLElement>(".master-modal");
      const title = modal?.querySelector("h3")?.textContent?.trim() || "";
      if (!modal || !title.startsWith("Quote response:")) {
        setTarget(null);
        return;
      }
      const form = modal.querySelector<HTMLElement>("form.master-form");
      if (!form) return;
      let mount = form.querySelector<HTMLElement>("[data-platform-registration-action]");
      if (!mount) {
        mount = document.createElement("div");
        mount.dataset.platformRegistrationAction = "true";
        form.prepend(mount);
      }
      setTarget(mount);
    };

    locateModal();
    const observer = new MutationObserver(locateModal);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target) return null;

  return createPortal(
    <section style={{
      border: "1px solid #d9e6df",
      borderRadius: 12,
      padding: 14,
      marginBottom: 14,
      background: "#f6fbf8",
    }}>
      <strong style={{ display: "block", marginBottom: 5 }}>Canonical customer access</strong>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
        Customer access is created through this Quote response. Company acceptance and Customer Quote approval remain linked to the same canonical record.
      </p>
    </section>,
    target,
  );
}
