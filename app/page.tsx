import Link from "next/link";
import { TopNav } from "@/components/top-nav";

export default function HomePage() {
  return (
    <div className="site-shell">
      <TopNav />
      <main className="landing-shell">
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="eyebrow">Mobile-Ready Construction Operations</p>
            <h2>Run handovers, daily reports, weekly reports, finance, and defects from one shared app.</h2>
            <p className="muted-copy">
              This production scaffold uses Next.js for the frontend, Supabase for login and cloud sync, and a PDF route
              for branded survey exports.
            </p>
            <div className="landing-actions">
              <Link className="primary-button" href="/dashboard">
                Open dashboard
              </Link>
              <Link className="secondary-button" href="/auth">
                Configure login
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
