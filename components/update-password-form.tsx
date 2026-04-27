"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/client";

export function UpdatePasswordForm() {
  const [email, setEmail] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    async function restoreRecoverySession() {
      try {
        const currentUrl = new URL(window.location.href);
        const hashParams = new URLSearchParams(currentUrl.hash.startsWith("#") ? currentUrl.hash.slice(1) : "");
        const code = currentUrl.searchParams.get("code");
        const tokenHash = currentUrl.searchParams.get("token_hash");
        const recoveryType = currentUrl.searchParams.get("type");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && recoveryType === "recovery") {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery"
          });
          if (verifyError) throw verifyError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          if (sessionError) throw sessionError;
        }

        const {
          data: { user }
        } = await supabase.auth.getUser();

        if (!isMounted) return;
        setEmail(user?.email ?? null);

        if (!user && (code || tokenHash || accessToken)) {
          setError("The password reset link could not be verified. Request a new reset email and try again.");
        }
      } catch (caughtError) {
        if (!isMounted) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to verify the password reset link.");
      } finally {
        if (!isMounted) return;
        setIsCheckingSession(false);
      }
    }

    void restoreRecoverySession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setEmail(session?.user?.email ?? null);
      setIsCheckingSession(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  function handleSubmit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    setError(null);
    setMessage(null);

    if (password.length < 8) {
      setError("Use at least 8 characters for the new password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The password confirmation does not match.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setMessage("Password updated. Redirecting you to sign in...");
      await supabase.auth.signOut();
      router.push("/auth?passwordUpdated=1" as Route);
      router.refresh();
    });
  }

  return (
    <div className="auth-card">
      <div className="stack">
        <p className="eyebrow">Finish Access Setup</p>
        <h3>Set your password</h3>
        <p className="muted-copy">
          {email
            ? `You are setting the password for ${email}.`
            : "Open this page from your password reset email to finish the password setup."}
        </p>
      </div>

      <form action={handleSubmit} className="stack top-gap">
        <label className="field">
          <span>New password</span>
          <input name="password" placeholder="At least 8 characters" required type="password" />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input name="confirmPassword" placeholder="Repeat the new password" required type="password" />
        </label>
        <button className="primary-button" disabled={isPending || isCheckingSession || !email} type="submit">
          {isPending ? "Saving..." : "Save password"}
        </button>
      </form>

      {isCheckingSession ? <p className="form-message">Checking your recovery session...</p> : null}
      {!isCheckingSession && !email && !error ? (
        <p className="form-message">No verified reset session was found yet. Open this page from the newest reset email link.</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
