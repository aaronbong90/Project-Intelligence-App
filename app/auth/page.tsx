import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { TopNav } from "@/components/top-nav";

export default function AuthPage() {
  return (
    <div className="site-shell">
      <TopNav />
      <main className="auth-shell">
        <section className="auth-layout">
          <div className="auth-copy">
            <p className="eyebrow">Secure Access</p>
            <h2>Invite project teams, contractors, and managers into one shared workspace.</h2>
            <p className="muted-copy">
              Supabase Auth handles secure login. Once configured, users can sign in from mobile or desktop and access
              only the projects they are assigned to.
            </p>
          </div>
          <Suspense>
            <AuthForm />
          </Suspense>
        </section>
      </main>
    </div>
  );
}
