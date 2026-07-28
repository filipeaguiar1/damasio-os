"use client";

import { useEffect, useRef, useState } from "react";

type Feedback = {
  kind: "pending" | "success" | "error";
  text: string;
};

const publishButtonSelector = ".advisor-publish-bar button";
const messageSelector = ".desktop-route-message";

function feedbackKind(text: string): Feedback["kind"] {
  return /published|saved|confirmed|success/i.test(text) ? "success" : "error";
}

export function RouteAdvisorFeedbackNavigator() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    let awaitingResult = false;
    let previousMessage = "";

    const clearDismissTimer = () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };

    const showResult = (next: Feedback) => {
      clearDismissTimer();
      setFeedback(next);
      if (next.kind !== "pending") {
        dismissTimer.current = window.setTimeout(() => setFeedback(null), 8000);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(publishButtonSelector);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;

      const currentMessage = document.querySelector(messageSelector)?.textContent?.trim() || "";
      previousMessage = currentMessage;
      awaitingResult = true;
      showResult({ kind: "pending", text: "Publishing the reviewed route…" });
    };

    const observer = new MutationObserver(() => {
      if (!awaitingResult) return;

      const message = document.querySelector(messageSelector);
      const text = message?.textContent?.trim() || "";
      if (!text || text === previousMessage || /Publishing the reviewed/i.test(text)) return;

      awaitingResult = false;
      const kind = feedbackKind(text);
      showResult({ kind, text });

      if (message instanceof HTMLElement) {
        message.setAttribute("role", kind === "success" ? "status" : "alert");
        message.setAttribute("aria-live", kind === "success" ? "polite" : "assertive");
        message.tabIndex = -1;
        window.requestAnimationFrame(() => {
          message.scrollIntoView({ behavior: "smooth", block: "start" });
          window.setTimeout(() => message.focus({ preventScroll: true }), 450);
        });
      }
    });

    document.addEventListener("click", onClick, true);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
      clearDismissTimer();
    };
  }, []);

  if (!feedback) return null;

  return <div
    className={`route-publish-feedback ${feedback.kind}`}
    role={feedback.kind === "error" ? "alert" : "status"}
    aria-live={feedback.kind === "error" ? "assertive" : "polite"}
  >
    <div>
      <strong>{feedback.kind === "pending"
        ? "Publishing route"
        : feedback.kind === "success"
          ? "Route published"
          : "Route was not published"}</strong>
      <span>{feedback.text}</span>
    </div>
    <button type="button" onClick={() => setFeedback(null)} aria-label="Close route publication message">×</button>

    <style jsx>{`
      .route-publish-feedback{position:fixed;z-index:10000;top:calc(env(safe-area-inset-top,0px) + 12px);left:50%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;width:min(560px,calc(100vw - 24px));padding:14px 16px;border:1px solid #c8d9d0;border-radius:16px;background:#fff;box-shadow:0 16px 45px rgba(4,61,46,.22);color:#173a2c;transform:translateX(-50%)}
      .route-publish-feedback.success{border-color:#81c69f;background:#edf9f2}.route-publish-feedback.error{border-color:#ef9a9a;background:#fff2f2;color:#7f1d1d}.route-publish-feedback.pending{border-color:#9ec7b3;background:#f3faf6}
      .route-publish-feedback div{display:grid;gap:3px;min-width:0}.route-publish-feedback strong{font-size:14px}.route-publish-feedback span{overflow-wrap:anywhere;font-size:12px;line-height:1.4;opacity:.82}.route-publish-feedback button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:999px;background:rgba(4,61,46,.09);color:inherit;font-size:22px;line-height:1;cursor:pointer}
    `}</style>
  </div>;
}
