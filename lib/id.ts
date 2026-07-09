export function createId(prefix = "id") {
  const cryptoObject =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? globalThis.crypto
      : undefined;

  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
