"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "projectaxis-theme";

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

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const initialTheme = getInitialTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function handleToggle() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <button className="ghost-button top-nav-utility-button" onClick={handleToggle} type="button">
      <span aria-hidden="true" className="nav-symbol nav-symbol-theme">
        {"\u25d0"}
      </span>
      Mode
    </button>
  );
}
