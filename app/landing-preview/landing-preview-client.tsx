"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROJECT_AXIS_TAGLINE, ProjectAxisMark, ProjectAxisWordmark } from "@/components/project-axis-brand";

type PreviewIconName = "oversight" | "report" | "shield" | "mobile" | "budget" | "team" | "clock" | "chart";

const features: Array<{
  icon: PreviewIconName;
  title: string;
  description: string;
  tone: string;
}> = [
  {
    icon: "oversight",
    title: "Project Oversight",
    description: "Real-time project status, module progress, issue visibility, and action ownership in one command view.",
    tone: "blue"
  },
  {
    icon: "report",
    title: "Automated Reporting",
    description: "Turn daily reports, submissions, drawings, defects, and handover records into client-ready outputs faster.",
    tone: "green"
  },
  {
    icon: "shield",
    title: "Quality & Compliance",
    description: "Keep survey, due diligence, drawing, completion, and defect workflows traceable from setup to handover.",
    tone: "amber"
  },
  {
    icon: "mobile",
    title: "Field-Ready Mobile",
    description: "Compact tables, camera-first uploads, quick actions, and bottom navigation built for site teams.",
    tone: "purple"
  },
  {
    icon: "budget",
    title: "Commercial Control",
    description: "Track claims, quotations, approvals, and payment decisions without losing context across email threads.",
    tone: "rose"
  },
  {
    icon: "team",
    title: "Team Collaboration",
    description: "Role-based access keeps clients, consultants, main contractors, and subcontractors aligned.",
    tone: "indigo"
  }
];

const stats = [
  { label: "Live Modules", value: "14+" },
  { label: "Report Types", value: "8" },
  { label: "Mobile Actions", value: "3 Tap" },
  { label: "Project Phases", value: "Setup + Delivery" }
];

const mobileHighlights = [
  "Switch between setup and delivery workstreams",
  "Create, review, and export records from the bottom bar",
  "Compact tables with full details available on demand",
  "AI support, filters, and attachments within each module"
];

function PreviewIcon({ name }: { name: PreviewIconName }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24"
  };

  if (name === "report") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h4" />
        <path d="M10 13h5" />
        <path d="M10 17h5" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }

  if (name === "mobile") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <rect height="18" rx="3" width="11" x="6.5" y="3" />
        <path d="M10 17h4" />
      </svg>
    );
  }

  if (name === "budget") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 4-4 3 3 5-7" />
      </svg>
    );
  }

  if (name === "team") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M16 20v-1a4 4 0 0 0-8 0v1" />
        <circle cx="12" cy="9" r="3" />
        <path d="M4 18v-1a3 3 0 0 1 3-3" />
        <path d="M20 18v-1a3 3 0 0 0-3-3" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  }

  if (name === "chart") {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M5 19V5" />
        <path d="M9 19v-6" />
        <path d="M13 19V8" />
        <path d="M17 19v-9" />
        <path d="M21 19H3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" {...commonProps}>
      <path d="M4 14h16" />
      <path d="M6 14v5" />
      <path d="M18 14v5" />
      <path d="M8 14V9a4 4 0 0 1 8 0v5" />
      <path d="M9 7h6" />
      <path d="M12 4v3" />
    </svg>
  );
}

export function LandingPreviewClient() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const scrollToHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) {
        return;
      }

      const section = document.getElementById(id);
      if (!section) {
        return;
      }

      const headerOffset = window.innerWidth <= 720 ? 86 : 92;
      const top = section.getBoundingClientRect().top + window.scrollY - headerOffset;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    };

    window.setTimeout(scrollToHash, 60);
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <div className="landing-preview-shell">
      <header className={`landing-preview-nav ${scrolled ? "is-scrolled" : ""}`}>
        <Link className="landing-preview-logo" href="/landing-preview" aria-label="ProjectAxis landing preview">
          <span className="landing-preview-logo-mark">
            <ProjectAxisMark />
          </span>
          <ProjectAxisWordmark className="landing-preview-wordmark" />
        </Link>

        <nav className="landing-preview-nav-links" aria-label="Landing preview navigation">
          <a href="#features">Features</a>
          <a href="#solutions">Solutions</a>
          <a href="#demo">Demo</a>
          <a href="#about">About</a>
        </nav>

        <div className="landing-preview-actions">
          <Link href="/auth">Log In</Link>
          <Link className="landing-preview-button landing-preview-button-dark" href="/dashboard">
            Open Dashboard
          </Link>
        </div>

        <button
          aria-expanded={isMenuOpen}
          aria-label="Toggle menu"
          className="landing-preview-menu-button"
          onClick={() => setIsMenuOpen((current) => !current)}
          type="button"
        >
          {isMenuOpen ? "X" : "Menu"}
        </button>

        {isMenuOpen ? (
          <div className="landing-preview-mobile-menu">
            <a href="#features" onClick={() => setIsMenuOpen(false)}>
              Features
            </a>
            <a href="#solutions" onClick={() => setIsMenuOpen(false)}>
              Solutions
            </a>
            <a href="#demo" onClick={() => setIsMenuOpen(false)}>
              Demo
            </a>
            <a href="#about" onClick={() => setIsMenuOpen(false)}>
              About
            </a>
            <Link href="/auth" onClick={() => setIsMenuOpen(false)}>
              Log In
            </Link>
            <Link className="landing-preview-button landing-preview-button-blue" href="/dashboard" onClick={() => setIsMenuOpen(false)}>
              Open Dashboard
            </Link>
          </div>
        ) : null}
      </header>

      <main>
        <section className="landing-preview-hero" id="hero">
          <div className="landing-preview-hero-overlay" />
          <div className="landing-preview-hero-content">
            <div className="landing-preview-pill">
              <span />
              {PROJECT_AXIS_TAGLINE}
            </div>
            <h1>
              Construction
              <span>Simplified.</span>
            </h1>
            <p>
              Streamline project setup, document submissions, daily reports, drawings, financial records, AI site
              intelligence, and close-out in one modern workspace.
            </p>
            <div className="landing-preview-hero-actions">
              <Link className="landing-preview-button landing-preview-button-blue" href="/dashboard">
                Book Demo
                <span aria-hidden="true">{"->"}</span>
              </Link>
              <a className="landing-preview-button landing-preview-button-glass" href="#features">
                View Features
              </a>
            </div>
            <div className="landing-preview-logo-row" aria-label="Example customer categories">
              <span>General Contractors</span>
              <span>Consultants</span>
              <span>Owners</span>
            </div>
          </div>

          <div className="landing-preview-dashboard-float" aria-label="ProjectAxis dashboard preview">
            <div className="landing-preview-window-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="landing-preview-dashboard-grid">
              <div>
                <span>Active Project</span>
                <strong>Marina Bay Sands</strong>
              </div>
              <div>
                <span>AI Risk</span>
                <strong>Medium</strong>
              </div>
              <div>
                <span>Daily Reports</span>
                <strong>28</strong>
              </div>
              <div>
                <span>Documents</span>
                <strong>142</strong>
              </div>
            </div>
            <div className="landing-preview-table-lines">
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="landing-preview-floating-card landing-preview-floating-card-left">
            <span className="landing-preview-card-icon">
              <PreviewIcon name="chart" />
            </span>
            <div>
              <small>Efficiency Up</small>
              <strong>+24%</strong>
            </div>
          </div>

          <div className="landing-preview-floating-card landing-preview-floating-card-right">
            <span className="landing-preview-card-icon">
              <PreviewIcon name="clock" />
            </span>
            <div>
              <small>Time Saved</small>
              <strong>12h/wk</strong>
            </div>
          </div>
        </section>

        <section className="landing-preview-stats" aria-label="ProjectAxis metrics">
          <div>
            {stats.map((stat) => (
              <article key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-preview-section" id="features">
          <div className="landing-preview-section-heading">
            <span>Features</span>
            <h2>
              Built for the job site,
              <br />
              made for the office.
            </h2>
            <p>Every tool needed to manage complex projects without chasing spreadsheets, chats, and email trails.</p>
          </div>

          <div className="landing-preview-feature-grid">
            {features.map((feature) => (
              <article className="landing-preview-feature-card" key={feature.title}>
                <span className={`landing-preview-feature-icon tone-${feature.tone}`}>
                  <PreviewIcon name={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <a href="#solutions">Learn more {"->"}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-preview-section landing-preview-solution-section" id="solutions">
          <div className="landing-preview-solution">
            <div className="landing-preview-solution-copy">
              <span className="landing-preview-solution-icon">
                <PreviewIcon name="mobile" />
              </span>
              <h2>
                Built for the field,
                <br />
                ready for the office.
              </h2>
              <p>
                ProjectAxis gives site teams quick access to daily actions while keeping records structured, readable,
                and ready for office review.
              </p>
              <ul>
                {mobileHighlights.map((item) => (
                  <li key={item}>
                    <span />
                    {item}
                  </li>
                ))}
              </ul>
              <Link className="landing-preview-button landing-preview-button-light" href="/dashboard">
                Explore the app
              </Link>
            </div>

            <div className="landing-preview-phone-preview" aria-label="Mobile app preview">
              <div className="landing-preview-phone">
                <div className="landing-preview-phone-header">
                  <span />
                  <strong>ProjectAxis</strong>
                  <span />
                </div>
                <div className="landing-preview-phone-card">
                  <small>Active Project</small>
                  <strong>Marina Bay Sands</strong>
                </div>
                <div className="landing-preview-phone-tabs">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="landing-preview-phone-list">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-preview-cta" id="demo">
          <div>
            <h2>
              Ready to nail your
              <br />
              next project?
            </h2>
            <div className="landing-preview-cta-actions">
              <Link className="landing-preview-button landing-preview-button-light" href="/dashboard">
                Open Dashboard
              </Link>
              <a className="landing-preview-button landing-preview-button-blue-dark" href="#features">
                Review Features
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-preview-footer" id="about">
        <div>
          <Link className="landing-preview-logo" href="/landing-preview">
            <span className="landing-preview-logo-mark">
              <ProjectAxisMark />
            </span>
            <ProjectAxisWordmark className="landing-preview-wordmark" />
          </Link>
          <p>Building the future of construction management with software that feels fast, clear, and site-ready.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#features">Features</a>
          <a href="#solutions">Solutions</a>
          <a href="/guide">Guide</a>
          <a href="/auth">Login</a>
        </nav>
        <small>&copy; 2026 ProjectAxis. All rights reserved.</small>
      </footer>
    </div>
  );
}
