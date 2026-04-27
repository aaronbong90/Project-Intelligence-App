import Link from "next/link";
import { TopNav } from "@/components/top-nav";

export default function HomePage() {
  return (
    <div className="site-shell">
      <TopNav />
      <main className="landing-shell">
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="eyebrow">Project Workspace</p>
            <h2>Keep project records, reports, finance, and defects in one place.</h2>
            <div className="landing-actions">
              <Link className="primary-button" href="/dashboard">
                Open dashboard
              </Link>
              <Link className="secondary-button" href="/guide">
                Help and FAQ
              </Link>
            </div>
          </div>

          <div className="landing-preview panel-surface">
            <div className="preview-badge">Live modules</div>
            <div className="preview-grid">
              <article>
                <span>Timeline</span>
                <strong>Countdown + milestones</strong>
              </article>
              <article>
                <span>Handover</span>
                <strong>Survey + defect logging</strong>
              </article>
              <article>
                <span>Reports</span>
                <strong>Daily + weekly updates</strong>
              </article>
              <article>
                <span>Financials</span>
                <strong>Quotations, invoices, VOs</strong>
              </article>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
