export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARTS = [
  "/apk/v52.0.1/part-00.bin",
  "/apk/v52.0.1/part-01.bin",
  "/apk/v52.0.1/part-02.bin",
  "/apk/v52.0.1/part-03.bin",
];

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const responses = await Promise.all(PARTS.map((part) => fetch(new URL(part, origin), { cache: "force-cache" })));
  if (responses.some((response) => !response.ok)) {
    return new Response("APK is temporarily unavailable.", { status: 503 });
  }

  const chunks = await Promise.all(responses.map((response) => response.arrayBuffer()));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const apk = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    apk.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return new Response(apk, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="damasio-os-mobile-v52.0.1.apk"',
      "Content-Length": String(total),
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
