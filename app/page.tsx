import Link from "next/link";
import { TopNav } from "@/components/top-nav";

export default function HomePage() {
  return (
    <div className="site-shell home-site-shell">
      <TopNav />
      <main className="landing-shell landing-shell-home">
        <section className="landing-hero landing-hero-wallpaper">
          <div className="landing-copy">
            <p className="landing-hero-pill">
              <span aria-hidden="true" />
              Blueprint intelligence workspace
            </p>
            <h2>
              <span className="desktop-hero-title">Keep every project moving.</span>
              <span className="mobile-hero-title">Keep projects moving.</span>
            </h2>
            <p className="landing-support">
              ProjectAxis brings records, reports, finance, handover tracking, and defects into one clean
              command workspace.
            </p>
            <div className="landing-actions">
              <Link className="primary-button" href="/dashboard">
                Open dashboard
              </Link>
              <Link className="secondary-button" href="/guide">
                Help and FAQ
              </Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="home-copyright-footer">© 2026 ProjectAxis. All rights reserved.</footer>
    </div>
  );
}
