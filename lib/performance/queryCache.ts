type CacheEntry<T> = {
  value: T;
  createdAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

export type CacheOptions = {
  ttlMs?: number;
  force?: boolean;
};

export async function cachedQuery<T>(key: string, loader: () => Promise<T>, options: CacheOptions = {}): Promise<T> {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;

  if (!options.force && hit && now - hit.createdAt < ttlMs) {
    return hit.value;
  }

  if (!options.force && pending.has(key)) {
    return pending.get(key) as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      cache.set(key, { value, createdAt: Date.now() });
      pending.delete(key);
      return value;
    })
    .catch((error) => {
      pending.delete(key);
      throw error;
    });

  pending.set(key, promise);
  return promise;
}

export function invalidateQuery(prefix?: string) {
  if (!prefix) {
    cache.clear();
    pending.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
}
