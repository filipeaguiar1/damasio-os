"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Manifest = { version: string; sha256: string; durationMs: number; updatedAt: string };

async function adminRequest(path: string, options?: RequestInit) {
  const client = getSupabaseBrowserClient() as any;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in as Admin.");
  const response = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options?.headers || {}) },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Opening operation failed.");
  return result;
}

export default function MobileAdminOpeningPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading current opening…");

  const refresh = useCallback(async () => {
    try {
      const result = await adminRequest("/api/admin/mobile-opening");
      setManifest(result.manifest || null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Opening status could not be loaded.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function choose(next: File | null) {
    setFile(next);
    setDurationMs(0);
    if (!next) return;
    if (next.type && next.type !== "video/mp4") {
      setMessage("Choose an MP4 video.");
      return;
    }
    const url = URL.createObjectURL(next);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 5000;
      setDurationMs(duration);
      setMessage("");
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      setMessage("This MP4 could not be read. Export as H.264 MP4 and try again.");
      URL.revokeObjectURL(url);
    };
    video.src = url;
  }

  async function upload() {
    if (!file) { inputRef.current?.click(); return; }
    setBusy(true);
    setMessage("Uploading opening…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("durationMs", String(durationMs || 5000));
      const result = await adminRequest("/api/admin/mobile-opening", { method: "POST", body: form });
      setManifest(result.manifest || null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setMessage("Opening published. Close the app completely and open it again to test.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Opening video could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["admin"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-native-subpage">
      <header className="role-mobile-topbar">
        <MobileBackButton fallback="/mobile/admin/more" />
        <div><strong>App Opening</strong><span>Remote startup video</span></div>
        <span className="role-mobile-avatar">4</span>
      </header>
      <section className="mobile-native-hero">
        <span>MOBILE BRAND</span>
        <h1>Change the opening without replacing the app.</h1>
        <p>Publish one H.264 MP4. Compatible mobile apps cache it locally and automatically refresh when a new version is available.</p>
      </section>

      {message && <div className="mobile-native-message">{message}</div>}

      <section className="mobile-native-panel" style={{display:"grid",gap:14}}>
        <div>
          <strong>Current opening</strong>
          <p style={{margin:"6px 0 0",opacity:.72}}>{manifest ? `Published ${new Date(manifest.updatedAt).toLocaleString("en-CA")} · ${(manifest.durationMs / 1000).toFixed(1)}s` : "No remote opening has been published yet."}</p>
        </div>
        <input ref={inputRef} type="file" accept="video/mp4,.mp4" hidden onChange={event => choose(event.target.files?.[0] || null)} />
        <button type="button" className="mobile-native-submit" onClick={() => inputRef.current?.click()} disabled={busy}>
          {file ? "Choose another MP4" : "Choose MP4"}
        </button>
        {file && <div className="mobile-native-message"><strong>{file.name}</strong><br/>{(file.size / 1024 / 1024).toFixed(2)} MB · {durationMs ? `${(durationMs / 1000).toFixed(1)}s` : "reading duration…"}</div>}
        <button type="button" className="mobile-native-submit" onClick={() => void upload()} disabled={busy || !file}>
          {busy ? "Publishing…" : "Publish opening"}
        </button>
      </section>
    </main>
  </MobileRoleGuard>;
}
