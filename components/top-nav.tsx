"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";

function getFallbackRoute(pathname: string, hasSession: boolean): Route {
  if (pathname.startsWith("/settings")) {
    return "/dashboard";
  }

  if (pathname.startsWith("/guide")) {
    return hasSession ? "/dashboard" : "/";
  }

  if (pathname.startsWith("/auth/update-password")) {
    return "/auth";
  }

  if (pathname.startsWith("/auth")) {
    return hasSession ? "/dashboard" : "/";
  }

  if (pathname.startsWith("/dashboard")) {
    return "/dashboard";
  }

  return "/";
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const showBackButton = pathname !== "/";

  const fallbackRoute = useMemo(() => getFallbackRoute(pathname, hasSession), [hasSession, pathname]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isConfigured) {
      setHasSession(false);
      return;
    }

    const supabase = createClient();
    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setHasSession(Boolean(data.session));
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setHasSession(Boolean(session));
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [isConfigured]);

  function handleBack() {
    if (typeof window === "undefined") return;

    const hasInternalReferrer = Boolean(document.referrer) && document.referrer.startsWith(window.location.origin);

    if (hasInternalReferrer && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackRoute, { scroll: false });
  }

  function handleLogout() {
    if (!isConfigured) return;

    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/auth");
      router.refresh();
    });
  }

  return (
    <header className="top-nav">
      <div className="top-nav-brand">
        <p className="eyebrow">Field Intelligence</p>
        <h1>Project Field Hub Pro</h1>
      </div>
      <button
        aria-controls="top-nav-menu"
        aria-expanded={isMobileMenuOpen}
        className="ghost-button top-nav-menu-button"
        onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
        type="button"
      >
        {isMobileMenuOpen ? "Close" : "Menu"}
      </button>
      <div className={`top-nav-actions${isMobileMenuOpen ? " is-open" : ""}`} id="top-nav-menu">
        <nav className="top-nav-links">
          <Link href="/" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            Home
          </Link>
          <Link href="/dashboard" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            Dashboard
          </Link>
          <Link href="/guide" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            Help
          </Link>
          <Link href="/settings" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            Settings
          </Link>
          {!hasSession ? (
            <Link href="/auth" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
              Login
            </Link>
          ) : null}
        </nav>
        <div className="top-nav-utility">
          <ThemeToggle />
          {showBackButton ? (
            <button className="ghost-button top-nav-utility-button" onClick={handleBack} type="button">
              Back
            </button>
          ) : null}
          {hasSession ? (
            <button className="ghost-button top-nav-utility-button" disabled={isPending} onClick={handleLogout} type="button">
              {isPending ? "Logging out..." : "Logout"}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
