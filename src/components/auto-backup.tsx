"use client";

import { useEffect } from "react";
import { localStorageEnabled } from "@/lib/storage-mode";

export function AutoBackup({ enabled = true, onError }: { enabled?: boolean; onError?: (message: string) => void }) {
  useEffect(() => {
    if (!enabled || !localStorageEnabled) return;
    let disposed = false;
    let pending = false;
    const check = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        const response = await fetch("/api/backup", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ auto: true }) });
        if (!response.ok && response.status !== 401) {
          const result = await response.json();
          if (!disposed) onError?.(result.error || "Automatic backup could not be completed.");
        }
      } catch { if (!disposed) onError?.("Automatic backup could not be completed. Check the backup drive."); }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void check(), 60_000);
    const initial = window.setTimeout(() => void check(), 5_000);
    const wake = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { disposed = true; window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [enabled, onError]);
  return null;
}
