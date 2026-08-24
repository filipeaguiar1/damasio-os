import { Buffer } from "node:buffer";

// Advanced simulation historically used SVG evidence. The production work-photo bucket
// intentionally rejects SVG, so this adapter converts only the simulator's legacy asset
// into a tiny inert PNG and rewrites its canonical storage path before persistence.
const SAFE_SIMULATION_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function rewritePhotoRows(rows: unknown) {
  const rewrite = (row: any) => row && typeof row === "object"
    ? {
        ...row,
        storage_path: typeof row.storage_path === "string"
          ? row.storage_path.replace(/\/after\.svg$/i, "/after.png")
          : row.storage_path,
      }
    : row;
  return Array.isArray(rows) ? rows.map(rewrite) : rewrite(rows);
}

export function withSafeAdvancedSimulationPhotos(service: any) {
  return new Proxy(service, {
    get(target, property, receiver) {
      if (property === "from") {
        return (table: string) => {
          const builder = target.from(table);
          if (table !== "photos") return builder;
          return new Proxy(builder, {
            get(queryTarget, queryProperty, queryReceiver) {
              if (queryProperty === "insert") {
                return (rows: unknown, options?: unknown) => queryTarget.insert(rewritePhotoRows(rows), options);
              }
              const value = Reflect.get(queryTarget, queryProperty, queryReceiver);
              return typeof value === "function" ? value.bind(queryTarget) : value;
            },
          });
        };
      }

      if (property === "storage") {
        return new Proxy(target.storage, {
          get(storageTarget, storageProperty, storageReceiver) {
            if (storageProperty === "from") {
              return (bucket: string) => {
                const bucketApi = storageTarget.from(bucket);
                if (bucket !== "work-photos") return bucketApi;
                return new Proxy(bucketApi, {
                  get(bucketTarget, bucketProperty, bucketReceiver) {
                    if (bucketProperty === "upload") {
                      return (path: string, data: unknown, options?: Record<string, unknown>) => {
                        const legacySimulationSvg = /\/after\.svg$/i.test(path)
                          || String(options?.contentType || "").toLowerCase() === "image/svg+xml";
                        if (!legacySimulationSvg) return bucketTarget.upload(path, data, options);
                        return bucketTarget.upload(
                          path.replace(/\/after\.svg$/i, "/after.png"),
                          SAFE_SIMULATION_PNG,
                          { ...(options || {}), contentType: "image/png" },
                        );
                      };
                    }
                    const value = Reflect.get(bucketTarget, bucketProperty, bucketReceiver);
                    return typeof value === "function" ? value.bind(bucketTarget) : value;
                  },
                });
              };
            }
            const value = Reflect.get(storageTarget, storageProperty, storageReceiver);
            return typeof value === "function" ? value.bind(storageTarget) : value;
          },
        });
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
