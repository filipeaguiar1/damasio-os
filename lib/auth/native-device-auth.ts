"use client";

export type NativeDeviceAuthStatus = {
  available: boolean;
  enabled: boolean;
  platform: "android" | "ios" | "unknown";
};

type NativeDeviceAuthResult = {
  action?: string;
  success?: boolean;
  enabled?: boolean;
  reason?: string;
};

type FourSeasonsNativeBridge = {
  isDeviceAuthAvailable?: () => boolean;
  isDeviceAuthEnabled?: () => boolean;
  getDeviceAuthPlatform?: () => string;
  requestEnableDeviceAuth?: () => void;
  disableDeviceAuth?: () => void;
  authenticateDevice?: () => void;
};

declare global {
  interface Window {
    FourSeasonsNative?: FourSeasonsNativeBridge;
  }
}

const RESULT_EVENT = "fourSeasonsDeviceAuth";

function nativeBridge() {
  if (typeof window === "undefined") return null;
  return window.FourSeasonsNative ?? null;
}

export function getNativeDeviceAuthStatus(): NativeDeviceAuthStatus {
  const bridge = nativeBridge();
  if (!bridge) return { available: false, enabled: false, platform: "unknown" };

  let platform: NativeDeviceAuthStatus["platform"] = "unknown";
  try {
    const value = bridge.getDeviceAuthPlatform?.();
    if (value === "android" || value === "ios") platform = value;
  } catch {
    platform = "unknown";
  }

  try {
    return {
      available: Boolean(bridge.isDeviceAuthAvailable?.()),
      enabled: Boolean(bridge.isDeviceAuthEnabled?.()),
      platform,
    };
  } catch {
    return { available: false, enabled: false, platform };
  }
}

function waitForNativeResult(action: string, timeoutMs = 30_000) {
  return new Promise<NativeDeviceAuthResult>((resolve) => {
    let settled = false;
    const finish = (result: NativeDeviceAuthResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(RESULT_EVENT, onResult as EventListener);
      window.clearTimeout(timeoutId);
      resolve(result);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<NativeDeviceAuthResult>).detail ?? {};
      if (detail.action && detail.action !== action) return;
      finish(detail);
    };
    const timeoutId = window.setTimeout(
      () => finish({ action, success: false, reason: "timeout" }),
      timeoutMs,
    );
    window.addEventListener(RESULT_EVENT, onResult as EventListener);
  });
}

export async function enableNativeDeviceAuth() {
  const bridge = nativeBridge();
  if (!bridge?.requestEnableDeviceAuth) {
    return { action: "enable", success: false, reason: "unavailable" } satisfies NativeDeviceAuthResult;
  }
  const result = waitForNativeResult("enable");
  bridge.requestEnableDeviceAuth();
  return result;
}

export async function disableNativeDeviceAuth() {
  const bridge = nativeBridge();
  if (!bridge?.disableDeviceAuth) {
    return { action: "disable", success: false, reason: "unavailable" } satisfies NativeDeviceAuthResult;
  }
  const result = waitForNativeResult("disable", 5_000);
  bridge.disableDeviceAuth();
  return result;
}

export async function authenticateNativeDevice() {
  const bridge = nativeBridge();
  if (!bridge?.authenticateDevice) {
    return { action: "authenticate", success: false, reason: "unavailable" } satisfies NativeDeviceAuthResult;
  }
  const result = waitForNativeResult("authenticate");
  bridge.authenticateDevice();
  return result;
}
