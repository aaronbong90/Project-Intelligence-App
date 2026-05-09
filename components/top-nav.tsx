"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ProjectNotification } from "@/types/app";

type TopNavNotificationEventDetail = {
  notifications?: ProjectNotification[];
};

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "projectaxis-theme";
const SESSION_HINT_STORAGE_KEY = "projectaxis-has-session";
const SESSION_EMAIL_STORAGE_KEY = "projectaxis-session-email";

type InitialSessionSnapshot = {
  email: string;
  hasSession: boolean;
};

function BellIcon() {
  return (
    <svg aria-hidden="true" className="notification-bell-icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M15.5 17.25h-7m9.1-2.5c-.8-.95-1.2-2.16-1.2-3.4V9.1a4.4 4.4 0 0 0-8.8 0v2.25c0 1.24-.43 2.45-1.2 3.4l-.7.85c-.4.48-.06 1.2.57 1.2h13.46c.63 0 .97-.72.57-1.2l-.7-.85ZM13.6 17.25a1.6 1.6 0 0 1-3.2 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function getInitials(email: string) {
  const namePart = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!namePart) return "U";

  const parts = namePart.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function getInitialSessionSnapshot(): InitialSessionSnapshot {
  if (typeof window === "undefined") {
    return { email: "", hasSession: false };
  }

  const storedEmail = window.localStorage.getItem(SESSION_EMAIL_STORAGE_KEY) ?? "";
  if (window.localStorage.getItem(SESSION_HINT_STORAGE_KEY) === "true") {
    return { email: storedEmail, hasSession: true };
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) continue;

    try {
      const parsedValue = JSON.parse(rawValue) as { user?: { email?: string } };
      return {
        email: parsedValue.user?.email ?? storedEmail,
        hasSession: true
      };
    } catch {
      return { email: storedEmail, hasSession: true };
    }
  }

  return { email: storedEmail, hasSession: false };
}

function rememberSession(hasSession: boolean, email = "") {
  if (typeof window === "undefined") return;

  if (hasSession) {
    window.localStorage.setItem(SESSION_HINT_STORAGE_KEY, "true");
    if (email) {
      window.localStorage.setItem(SESSION_EMAIL_STORAGE_KEY, email);
    }
    return;
  }

  window.localStorage.removeItem(SESSION_HINT_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_EMAIL_STORAGE_KEY);
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [hasNotificationContext, setHasNotificationContext] = useState(false);
  const [notifications, setNotifications] = useState<ProjectNotification[]>([]);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [isPending, startTransition] = useTransition();
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const useCompactTopNav = true;
  const shouldShowNotificationBell = true;
  const notificationCount = notifications.length;
  const accountInitials = userEmail ? getInitials(userEmail) : "PX";
  const accountName = userEmail ? userEmail.split("@")[0].replace(/[._-]+/g, " ") : "ProjectAxis";
  const isCurrentPath = (href: string) => pathname === href || (href !== "/" && pathname?.startsWith(`${href}/`));

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsNotificationOpen(false);
    setIsAccountMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleNotificationUpdate(event: Event) {
      const detail = (event as CustomEvent<TopNavNotificationEventDetail>).detail;
      setHasNotificationContext(true);
      setNotifications(Array.isArray(detail?.notifications) ? detail.notifications : []);
    }

    window.addEventListener("projectaxis:notifications", handleNotificationUpdate);

    return () => {
      window.removeEventListener("projectaxis:notifications", handleNotificationUpdate);
    };
  }, []);

  useEffect(() => {
    const initialTheme = getInitialTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    const sessionSnapshot = getInitialSessionSnapshot();
    setHasSession(sessionSnapshot.hasSession);
    setUserEmail(sessionSnapshot.email);
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setHasSession(false);
      setUserEmail("");
      rememberSession(false);
      return;
    }

    const supabase = createClient();
    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      const nextHasSession = Boolean(data.session);
      const nextEmail = data.session?.user.email ?? "";
      setHasSession(nextHasSession);
      setUserEmail(nextEmail);
      rememberSession(nextHasSession, nextEmail);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      const nextHasSession = Boolean(session);
      const nextEmail = session?.user.email ?? "";
      setHasSession(nextHasSession);
      setUserEmail(nextEmail);
      rememberSession(nextHasSession, nextEmail);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [isConfigured]);

  function handleLogout() {
    if (!isConfigured) return;

    startTransition(async () => {
      rememberSession(false);
      setHasSession(false);
      setUserEmail("");
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/auth");
      router.refresh();
    });
  }

  function handleThemeToggle() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    setIsAccountMenuOpen(false);
    setIsNotificationOpen(false);
  }

  function handleNotificationToggle() {
    setIsNotificationOpen((isOpen) => {
      const nextIsOpen = !isOpen;
      if (nextIsOpen) {
        setIsAccountMenuOpen(false);
        setIsMobileMenuOpen(false);
      }
      return nextIsOpen;
    });
  }

  function handleAccountMenuToggle() {
    setIsAccountMenuOpen((isOpen) => {
      const nextIsOpen = !isOpen;
      if (nextIsOpen) {
        setIsNotificationOpen(false);
        setIsMobileMenuOpen(false);
      }
      return nextIsOpen;
    });
  }

  return (
    <header className={`top-nav${useCompactTopNav ? " top-nav-compact" : ""}`}>
      <div className="top-nav-brand">
        <div className="top-nav-logo-lockup" aria-label="ProjectAxis - Build. Execute. Accelerate.">
          <span aria-hidden="true" className="top-nav-logo-mark">
            <span className="top-nav-logo-cross" />
          </span>
          <span className="top-nav-logo-word">
            <h1>ProjectAxis</h1>
            <span className="top-nav-logo-tagline">Build. Execute. Accelerate.</span>
          </span>
        </div>
      </div>
      <div className="top-nav-controls">
        {shouldShowNotificationBell ? (
          <div className="top-nav-notifications">
            <button
              aria-expanded={isNotificationOpen}
              aria-label={notificationCount ? `Open ${notificationCount} project updates` : "Open project updates"}
              className="notification-bell-button"
              onClick={handleNotificationToggle}
              type="button"
            >
              <BellIcon />
              <span className="notification-badge">{notificationCount}</span>
            </button>
            {isNotificationOpen ? (
              <div className="notification-popover">
                <div className="notification-popover-header">
                  <div>
                    <p className="eyebrow">Notifications</p>
                    <h3>Project updates</h3>
                  </div>
                  <span className="pill">{notificationCount} updates</span>
                </div>
                {notificationCount ? (
                  <div className="top-notification-list">
                    {notifications.slice(0, 6).map((notification) => (
                      <article className="top-notification-item" key={notification.id}>
                        <span aria-hidden="true" className="notification-dot" />
                        <div>
                          <strong>{notification.title}</strong>
                          {notification.details ? <p>{notification.details}</p> : null}
                          <small>
                            {notification.actorEmail || "System"} - {notification.section} - {formatDateTime(notification.createdAt)}
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="notification-empty-state">No project changes have been logged yet.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {useCompactTopNav ? (
          <div className="top-nav-account">
            <button
              aria-expanded={isAccountMenuOpen}
              aria-label="Open account menu"
              className="account-avatar-button"
              onClick={handleAccountMenuToggle}
              type="button"
            >
              {accountInitials}
            </button>
            {isAccountMenuOpen ? (
              <div className="account-popover">
                <div className="account-popover-profile">
                  <span className="account-avatar-large">{accountInitials}</span>
                  <strong>{accountName}</strong>
                  {userEmail ? <span>{userEmail}</span> : null}
                </div>
                <div className="account-menu-list">
                  <Link className="account-menu-item" href="/" onClick={() => setIsAccountMenuOpen(false)} scroll={false}>
                    <span className="account-menu-left">
                      <span className="account-menu-symbol account-menu-symbol-home">
                        {"\u2302"}
                      </span>
                      Home
                    </span>
                    {isCurrentPath("/") ? <span className="account-menu-current">Current</span> : null}
                  </Link>
                  <Link className="account-menu-item" href="/dashboard" onClick={() => setIsAccountMenuOpen(false)} scroll={false}>
                    <span className="account-menu-left">
                      <span className="account-menu-symbol account-menu-symbol-dashboard">
                        {"\u25a6"}
                      </span>
                      Dashboard
                    </span>
                    {isCurrentPath("/dashboard") ? <span className="account-menu-current">Current</span> : null}
                  </Link>
                  <Link className="account-menu-item" href="/guide" onClick={() => setIsAccountMenuOpen(false)} scroll={false}>
                    <span className="account-menu-left">
                      <span className="account-menu-symbol account-menu-symbol-help">
                        ?
                      </span>
                      Help
                    </span>
                    {isCurrentPath("/guide") ? <span className="account-menu-current">Current</span> : null}
                  </Link>
                  <Link className="account-menu-item" href="/settings" onClick={() => setIsAccountMenuOpen(false)} scroll={false}>
                    <span className="account-menu-left">
                      <span className="account-menu-symbol account-menu-symbol-settings">
                        {"\u2699"}
                      </span>
                      Settings
                    </span>
                    {isCurrentPath("/settings") ? <span className="account-menu-current">Current</span> : null}
                  </Link>
                  <button className="account-menu-item" onClick={handleThemeToggle} type="button">
                    <span className="account-menu-left">
                      <span className="account-menu-symbol account-menu-symbol-theme">
                        {"\u25d0"}
                      </span>
                      Mode
                    </span>
                  </button>
                  <span className="account-menu-divider" />
                  {hasSession ? (
                    <button className="account-menu-item" disabled={isPending} onClick={handleLogout} type="button">
                      <span className="account-menu-left">
                        <span className="account-menu-symbol account-menu-symbol-signout">
                          {"\u2192"}
                        </span>
                        {isPending ? "Logging out..." : "Logout"}
                      </span>
                    </button>
                  ) : (
                    <Link className="account-menu-item" href="/auth" onClick={() => setIsAccountMenuOpen(false)} scroll={false}>
                      <span className="account-menu-left">
                        <span className="account-menu-symbol account-menu-symbol-signout">
                          {"\u2192"}
                        </span>
                        Login
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <button
            aria-controls="top-nav-menu"
            aria-expanded={isMobileMenuOpen}
            className="ghost-button top-nav-menu-button"
            onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
            type="button"
          >
            <span aria-hidden="true" className="nav-symbol nav-symbol-menu">
              {isMobileMenuOpen ? "\u00d7" : "\u2261"}
            </span>
            {isMobileMenuOpen ? "Close" : "Menu"}
          </button>
        )}
      </div>
      {!useCompactTopNav ? <div className={`top-nav-actions${isMobileMenuOpen ? " is-open" : ""}`} id="top-nav-menu">
        <nav className="top-nav-links">
          <Link href="/" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            <span aria-hidden="true" className="nav-symbol nav-symbol-home">
              {"\u2302"}
            </span>
            Home
          </Link>
          <Link href="/dashboard" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            <span aria-hidden="true" className="nav-symbol nav-symbol-dashboard">
              {"\u25a6"}
            </span>
            Dashboard
          </Link>
          <Link href="/guide" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            <span aria-hidden="true" className="nav-symbol nav-symbol-help">
              ?
            </span>
            Help
          </Link>
          <Link href="/settings" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
            <span aria-hidden="true" className="nav-symbol nav-symbol-settings">
              {"\u2699"}
            </span>
            Settings
          </Link>
          {!hasSession ? (
            <Link href="/auth" onClick={() => setIsMobileMenuOpen(false)} scroll={false}>
              <span aria-hidden="true" className="nav-symbol nav-symbol-login">
                {"\u2192"}
              </span>
              Login
            </Link>
          ) : null}
        </nav>
        <div className="top-nav-utility">
          <ThemeToggle />
          {hasSession ? (
            <button className="ghost-button top-nav-utility-button" disabled={isPending} onClick={handleLogout} type="button">
              <span aria-hidden="true" className="nav-symbol nav-symbol-login">
                {"\u2192"}
              </span>
              {isPending ? "Logging out..." : "Logout"}
            </button>
          ) : null}
        </div>
      </div> : null}
    </header>
  );
}
