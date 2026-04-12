"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/client";

type Mode = "sign_in" | "sign_up";

export function AuthForm() {
  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const [mode, setMode] = useState<Mode>("sign_in");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/dashboard";

  function handleSubmit(formData: FormData) {
    if (!isConfigured) {
      setError("Add your Supabase credentials in .env.local before using login.");
      return;
    }

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    setError(null);
    setMessage(null);

    startTransition(async () => {
      const action =
        mode === "sign_in"
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({ email, password });

      const { error: authError } = await action;

      if (authError) {
        setError(authError.message);
        return;
      }

      if (mode === "sign_up") {
        setMessage("Account created. Check your email if email confirmation is enabled in Supabase.");
      }

      router.push(redirectTo as Route);
      router.refresh();
    });
  }

  return (
    <div className="auth-card">
      <div className="auth-toggle">
        <button
          className={mode === "sign_in" ? "active" : ""}
          type="button"
          onClick={() => setMode("sign_in")}
        >
          Sign in
        </button>
        <button
          className={mode === "sign_up" ? "active" : ""}
          type="button"
          onClick={() => setMode("sign_up")}
        >
          Create account
        </button>
      </div>

      <form action={handleSubmit} className="stack">
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" placeholder="you@company.com" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" placeholder="At least 8 characters" required />
        </label>
        <button className="primary-button" type="submit" disabled={isPending || !isConfigured}>
          {isPending ? "Please wait..." : mode === "sign_in" ? "Sign in" : "Create account"}
        </button>
      </form>

      {!isConfigured ? <p className="form-message">Demo mode is active. Configure Supabase to enable login.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
