"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import type { AppUserProfile, ProjectBundle } from "@/types/app";

type DashboardPayload = {
  projects: ProjectBundle[];
  viewer: AppUserProfile | null;
  isConfigured: boolean;
  todaySnapshot: string;
};

export function DashboardRouteClient() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    async function load() {
      try {
        setError(null);
        setPayload(null);

        const response = await fetch("/api/dashboard-data", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        const rawPayload = await response.text();
        const nextPayload = (rawPayload ? JSON.parse(rawPayload) : {}) as Partial<DashboardPayload> & { error?: string };

        if (response.status === 401) {
          const redirectTo = `${window.location.pathname}${window.location.hash || ""}`;
          window.location.replace(`/auth?redirectTo=${encodeURIComponent(redirectTo)}`);
          return;
        }

        if (!response.ok) {
          throw new Error(nextPayload.error ?? "Unable to load the dashboard.");
        }

        if (requestId === requestIdRef.current) {
          setPayload(nextPayload as DashboardPayload);
        }
      } catch (caughtError) {
        if (requestId === requestIdRef.current) {
          const isAbortError = caughtError instanceof DOMException && caughtError.name === "AbortError";
          setError(isAbortError ? "Dashboard data request timed out. Please try again." : caughtError instanceof Error ? caughtError.message : "Unable to load the dashboard.");
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void load();

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [requestNonce]);

  if (error) {
    return (
      <section className="content-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h3>Unable to load the dashboard</h3>
          </div>
        </div>
        <p className="form-error">{error}</p>
        <div className="record-actions top-gap">
          <button className="primary-button" onClick={() => setRequestNonce((current) => current + 1)} type="button">
            Try again
          </button>
          <Link className="ghost-button" href="/auth">
            Back to login
          </Link>
        </div>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="content-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h3>Loading your project workspace</h3>
          </div>
        </div>
        <p className="muted-copy">Pulling the latest project data now.</p>
      </section>
    );
  }

  return (
    <DashboardShell
      initialProjects={payload.projects}
      isConfigured={payload.isConfigured}
      todaySnapshot={payload.todaySnapshot}
      viewer={payload.viewer}
    />
  );
}
