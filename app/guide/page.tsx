import Link from "next/link";
import { TopNav } from "@/components/top-nav";

const quickStartSteps = [
  "Sign in with the email and password created for your account.",
  "Open or select a project from the dashboard.",
  "Use the module list to switch between overview, documents, reports, finance, completion, and defects.",
  "Tap a saved record to expand it, then edit or update it when needed.",
  "Use Settings to manage passwords and user access based on your role."
];

const moduleGuides = [
  {
    title: "Overview",
    items: ["Update project dates and key details.", "Review milestones, team setup, and consultant details."]
  },
  {
    title: "Documents Submission",
    items: ["Create grouped contractor or consultant submissions.", "Track pending, approved, accepted, returned, or rejected statuses."]
  },
  {
    title: "Reports",
    items: ["Record daily site work, manpower, and photos.", "Store weekly reports and progress summaries with photo or document attachments."]
  },
  {
    title: "Financial Register",
    items: ["Upload quotations, invoices, and variation orders.", "Track draft, submitted, approved, rejected, and paid records."]
  },
  {
    title: "Completion and Defects",
    items: ["Add close-out checklist items in batches.", "Log defects by zone, import from Excel, and update statuses."]
  }
];

const faqItems = [
  {
    question: "How do I start using the app on a new project?",
    answer:
      "Open the dashboard, create or select a project, then work through the modules as needed. Start with Overview, then move into documents, reports, finance, completion, or defects."
  },
  {
    question: "Why can I only see some modules?",
    answer:
      "Module access is controlled by your project role. If something is missing, the person managing your project access may need to update your Settings."
  },
  {
    question: "How do I edit a saved record?",
    answer:
      "Tap or click the saved card to expand it. Most records now open into an inline edit form so you can update them without deleting and recreating them."
  },
  {
    question: "Why can’t I upload video right now?",
    answer:
      "The current rollout is tuned for the free pilot. Video is switched off to protect the free storage and bandwidth limits, while photos and document uploads stay available."
  },
  {
    question: "How do password changes work?",
    answer:
      "Users can change their own password from Settings after signing in. Reset-password links from email can also be used when recovery is needed."
  },
  {
    question: "How should I use the app on mobile?",
    answer:
      "Use the app in portrait mode for normal work. The layout is stacked for vertical screens, and wider multi-column spacing only opens up when the phone is rotated to landscape."
  },
  {
    question: "Where should instructions live now?",
    answer:
      "This Help page is the main reference point. The working pages are intentionally lighter now so people can focus on tasks instead of setup notes."
  }
];

export default function GuidePage() {
  return (
    <div className="site-shell">
      <TopNav />
      <main className="help-shell">
        <section className="hero-card">
          <div className="hero-copy-block">
            <p className="eyebrow">Help</p>
            <h2>How to use Project Field Hub</h2>
            <p className="hero-description">Quick guides, module tips, and answers to common questions.</p>
            <div className="landing-actions">
              <Link className="primary-button" href="/dashboard">
                Open dashboard
              </Link>
              <Link className="secondary-button" href="/settings">
                Open settings
              </Link>
            </div>
          </div>
          <div className="countdown-card">
            <span>Use this page for</span>
            <strong>Setup, navigation, and FAQs</strong>
            <small>Day-to-day pages are kept lighter so the app feels cleaner on mobile.</small>
          </div>
        </section>

        <div className="help-layout">
          <aside className="panel-surface help-sidebar">
            <p className="eyebrow">Sections</p>
            <div className="help-link-stack">
              <a href="#quick-start">Quick Start</a>
              <a href="#roles">Roles and Access</a>
              <a href="#modules">Module Guide</a>
              <a href="#mobile">Mobile Tips</a>
              <a href="#faq">FAQ</a>
            </div>
          </aside>

          <div className="help-section-grid">
            <section className="content-card" id="quick-start">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Quick Start</p>
                  <h3>Use the app in five steps</h3>
                </div>
              </div>
              <ol className="help-steps">
                {quickStartSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>

            <section className="content-card" id="roles">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Roles</p>
                  <h3>Who controls what</h3>
                </div>
              </div>
              <div className="help-card-grid">
                <article className="record-surface">
                  <strong>Client</strong>
                  <ul className="help-list">
                    <li>Can manage their own directory and assigned project access.</li>
                    <li>Reviews selected submissions and approvals.</li>
                  </ul>
                </article>
                <article className="record-surface">
                  <strong>Consultant</strong>
                  <ul className="help-list">
                    <li>Works inside assigned modules and project access.</li>
                    <li>Can review or submit records where permissions allow.</li>
                  </ul>
                </article>
                <article className="record-surface">
                  <strong>Contractor / Sub Contractor</strong>
                  <ul className="help-list">
                    <li>Submits documents, reports, finance records, completion items, and defects based on access.</li>
                    <li>Can edit saved records where project permissions allow.</li>
                  </ul>
                </article>
              </div>
            </section>

            <section className="content-card" id="modules">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Modules</p>
                  <h3>Where to find each task</h3>
                </div>
              </div>
              <div className="help-card-grid">
                {moduleGuides.map((module) => (
                  <article className="record-surface" key={module.title}>
                    <strong>{module.title}</strong>
                    <ul className="help-list">
                      {module.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="content-card" id="mobile">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Mobile</p>
                  <h3>Best way to use it on a phone</h3>
                </div>
              </div>
              <ul className="help-list">
                <li>Use portrait mode for normal work. The app is now tuned to stack cards and forms vertically first.</li>
                <li>Switch modules from the top of the page or the mobile module strip instead of scrolling through every section.</li>
                <li>Open only the card you are working on. Saved records stay collapsed until tapped.</li>
                <li>Rotate to landscape only when you want more horizontal space for grouped forms or long attachment lists.</li>
              </ul>
            </section>

            <section className="content-card" id="faq">
              <div className="section-header">
                <div>
                  <p className="eyebrow">FAQ</p>
                  <h3>Common questions</h3>
                </div>
              </div>
              <div className="faq-list">
                {faqItems.map((item) => (
                  <details className="faq-item" key={item.question}>
                    <summary>{item.question}</summary>
                    <p>{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
