import { UpdatePasswordForm } from "@/components/update-password-form";
import { TopNav } from "@/components/top-nav";

export default function UpdatePasswordPage() {
  return (
    <div className="site-shell">
      <TopNav />
      <main className="auth-shell">
        <section className="auth-layout">
          <div className="auth-copy">
            <p className="eyebrow">Secure Access</p>
            <h2>Set a new password.</h2>
            <p className="muted-copy">Save your new password to continue.</p>
          </div>
          <UpdatePasswordForm />
        </section>
      </main>
    </div>
  );
}
