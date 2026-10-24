import { useEffect } from "react";

import { startTransitPlayback } from "@/map/transit/playback";
import { startTransitPolling } from "@/map/transit/poll-feed";
import { useTransitStore } from "@/map/transit/store";

/** Browsers only read our shared cache; upstream collection is server-owned. */
export function useTransitFeed(): void {
  const enabled = useTransitStore((state) => state.enabled);

  useEffect(
    () =>
      startTransitPlayback({
        isVisible: () => !document.hidden,
        subscribeVisibility: (listener) => {
          document.addEventListener("visibilitychange", listener);
          return () =>
            document.removeEventListener("visibilitychange", listener);
        },
      }),
    []
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return startTransitPolling({
      isVisible: () => !document.hidden,
      subscribeVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      receive: (snapshot) => useTransitStore.getState().receive(snapshot),
      fail: (message) => useTransitStore.getState().fail(message),
    });
  }, [enabled]);
}
