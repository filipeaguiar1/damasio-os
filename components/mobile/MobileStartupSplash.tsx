"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type OpeningManifest = { version: string | null; url: string | null; durationMs: number };

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}) {
  const openRef = useRef(onOpen);
  const doneRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manifest, setManifest] = useState<OpeningManifest | null>(null);
  const [failed, setFailed] = useState(false);
  openRef.current = onOpen;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    openRef.current();
  }, []);

  useEffect(() => {
    if (navigator.userAgent.includes("NativeOpening/1")) {
      finish();
      return;
    }
    let active = true;
    const safety = window.setTimeout(finish, 8000);
    void fetch("/api/mobile/opening", { cache: "no-store" })
      .then(response => response.json())
      .then(result => {
        if (!active) return;
        if (!result?.url) {
          setFailed(true);
          window.setTimeout(finish, 500);
          return;
        }
        setManifest({ version: result.version || null, url: result.url, durationMs: Number(result.durationMs || 5000) });
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        window.setTimeout(finish, 700);
      });
    return () => { active = false; window.clearTimeout(safety); };
  }, [finish]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifest?.url) return;
    const attempt = () => { void video.play().catch(() => undefined); };
    attempt();
    const retry = window.setTimeout(attempt, 180);
    return () => window.clearTimeout(retry);
  }, [manifest]);

  if (typeof navigator !== "undefined" && navigator.userAgent.includes("NativeOpening/1")) return null;

  return <main className="ever-video-opening" aria-label="4Ever Seasons opening">
    {manifest?.url && !failed ? <video
      ref={videoRef}
      className="ever-opening-video"
      src={manifest.url}
      autoPlay
      muted
      playsInline
      preload="auto"
      controls={false}
      disablePictureInPicture
      disableRemotePlayback
      controlsList="nodownload nofullscreen noplaybackrate"
      onLoadedData={() => { void videoRef.current?.play().catch(() => undefined); }}
      onCanPlay={() => { void videoRef.current?.play().catch(() => undefined); }}
      onEnded={finish}
      onError={() => { setFailed(true); window.setTimeout(finish, 700); }}
    /> : <div className="ever-opening-neutral" />}
    <style jsx global>{`
      .ever-video-opening{position:fixed!important;inset:0!important;z-index:99999!important;width:100vw!important;height:100dvh!important;overflow:hidden!important;background:#f4eddc!important;display:block!important}
      .ever-opening-video{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;background:#f4eddc!important;pointer-events:none!important;border:0!important;outline:0!important}
      .ever-opening-neutral{position:absolute;inset:0;background:#f4eddc}
      .ever-opening-video::-webkit-media-controls,.ever-opening-video::-webkit-media-controls-enclosure,.ever-opening-video::-webkit-media-controls-panel,.ever-opening-video::-webkit-media-controls-play-button,.ever-opening-video::-webkit-media-controls-start-playback-button{display:none!important;-webkit-appearance:none!important;opacity:0!important;pointer-events:none!important}
    `}</style>
  </main>;
}
