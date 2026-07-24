type RpcClient = {
  rpc: (name: never, args?: never) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const transientPatterns = [
  "failed to fetch",
  "network",
  "timeout",
  "temporarily",
  "connection",
  "rate limit",
  "too many requests",
];

function isTransient(message: string) {
  const normalized = message.toLowerCase();
  return transientPatterns.some(pattern => normalized.includes(pattern));
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function reliableRpc<T = unknown>(
  client: RpcClient,
  name: string,
  args?: Record<string, unknown>,
  options?: { attempts?: number; timeoutMs?: number }
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 2);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const timeoutMs = Math.max(3000, options?.timeoutMs ?? 15000);
      const timeout = new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error("Request timed out. Please try again.")), timeoutMs);
      });
      const request = Promise.resolve(client.rpc(name as never, (args || {}) as never));
      const { data, error } = await Promise.race([request, timeout]);
      if (error) throw new Error(error.message || "Request failed.");
      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Request failed.");
      if (attempt === attempts || !isTransient(lastError.message)) break;
      await wait(350 * attempt);
    }
  }

  throw lastError || new Error("Request failed.");
}
