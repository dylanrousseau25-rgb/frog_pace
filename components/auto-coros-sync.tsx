"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const CHECK_EVERY_MS = 15 * 60 * 1000;

export function AutoCorosSync() {
  const router = useRouter();
  const runningRef = useRef(false);

  useEffect(() => {
    async function run() {
      if (runningRef.current || document.visibilityState !== "visible") return;
      runningRef.current = true;
      try {
        const response = await fetch("/api/coros/auto-sync", {
          method: "POST",
          cache: "no-store",
          headers: { "x-frog-auto-sync": "1" },
        });
        if (!response.ok) return;
        const body = await response.json().catch(() => null);
        if (Number(body?.newActivities || 0) > 0) router.refresh();
      } catch {
        // Silent by design: manual sync remains available as a fallback.
      } finally {
        runningRef.current = false;
      }
    }

    void run();
    const interval = window.setInterval(() => void run(), CHECK_EVERY_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
