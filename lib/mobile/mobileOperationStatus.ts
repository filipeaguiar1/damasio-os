export const MOBILE_OPERATION_STATUS_EVENT = "damasio-mobile-operation-status";

export type MobileOperationStatus = {
  phase: "working" | "success" | "error" | "clear";
  title?: string;
  message?: string;
};

function emit(detail: MobileOperationStatus) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MOBILE_OPERATION_STATUS_EVENT, { detail }));
}

export function beginMobileOperation(title: string, message: string) {
  emit({ phase: "working", title, message });
}

export function completeMobileOperation(title: string, message: string) {
  emit({ phase: "success", title, message });
}

export function failMobileOperation(title: string, message: string) {
  emit({ phase: "error", title, message });
}

export function clearMobileOperation() {
  emit({ phase: "clear" });
}
