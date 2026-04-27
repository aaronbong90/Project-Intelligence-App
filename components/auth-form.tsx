"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/client";

type Mode = "sign_in" | "request_reset";

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
  const passwordUpdated = searchParams.get("passwordUpdated") === "1";

  function handleSubmit(formData: FormData) {
    if (!isConfigured) {
      setError("Add your Supabase credentials in .env.local before using login.");
      return;
    }

    const email = String(formData.get("email") ?? "");
    const supabase = createClient();

    setError(null);
    setMessage(null);

    startTransition(async () => {
      if (mode === "request_reset") {
        const redirectUrl =
          typeof window !== "undefined" ? `${window.location.origin}/auth/update-password` : undefined;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectUrl
        });

        if (resetError) {
          setError(resetError.message);
          return;
        }

        setMessage("Password reset email sent. Open the link in that email to set a new password.");
        return;
      }

      const password = String(formData.get("password") ?? "");
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        setError(authError.message);
        return;
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
          className={mode === "request_reset" ? "active" : ""}
          type="button"
          onClick={() => setMode("request_reset")}
        >
          Reset password
        </button>
      </div>

      <form action={handleSubmit} className="stack">
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" placeholder="you@company.com" required />
        </label>
        {mode === "sign_in" ? (
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" placeholder="At least 8 characters" required />
          </label>
        ) : null}
        <button className="primary-button" type="submit" disabled={isPending || !isConfigured}>
          {isPending ? "Please wait..." : mode === "sign_in" ? "Sign in" : "Send reset email"}
        </button>
      </form>

      {!isConfigured ? <p className="form-message">Demo mode is active. Configure Supabase to enable login.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
      {!message && passwordUpdated ? (
        <p className="form-message">Password updated successfully. Sign in with your new password.</p>
      ) : null}
    </div>
  );
}
