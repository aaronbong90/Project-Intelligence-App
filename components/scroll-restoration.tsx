"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

const SCROLL_KEY_PREFIX = "projectaxis-scroll";

export function ScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationKey = useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) {
      return;
    }

    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storageKey = `${SCROLL_KEY_PREFIX}:${locationKey}`;
    const restoreScroll = () => {
      const storedScroll = window.sessionStorage.getItem(storageKey);
      if (!storedScroll) {
        return;
      }

      const nextScroll = Number.parseInt(storedScroll, 10);
      if (!Number.isFinite(nextScroll)) {
        return;
      }

      window.scrollTo({ left: 0, top: nextScroll, behavior: "auto" });
    };

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restoreScroll);
    });

    const saveScroll = () => {
      window.sessionStorage.setItem(storageKey, String(window.scrollY));
    };

    const onScroll = () => {
      window.requestAnimationFrame(saveScroll);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", saveScroll);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", saveScroll);
      saveScroll();
    };
  }, [locationKey]);

  return null;
}
