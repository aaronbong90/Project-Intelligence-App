import { formatCountdown, formatDate } from "@/lib/utils";
import type { ProjectOverview } from "@/types/app";

export function ProjectSummaryCard({ project }: { project: ProjectOverview }) {
  return (
    <section className="hero-card">
      <div className="hero-copy-block">
        <p className="eyebrow">Active Project</p>
        <h2>{project.name}</h2>
        <p className="hero-description">{project.details}</p>
        <div className="hero-meta-grid">
          <div>
            <span>Location</span>
            <strong>{project.location || "Not set"}</strong>
          </div>
          <div>
            <span>Client</span>
            <strong>{project.clientName || "Not set"}</strong>
          </div>
          <div>
            <span>Contractor</span>
            <strong>{project.contractorName || "Not set"}</strong>
          </div>
          <div>
            <span>Handover</span>
            <strong>{formatDate(project.handoverDate)}</strong>
          </div>
        </div>
      </div>
      <div className="countdown-card">
        <span>Countdown</span>
        <strong>{formatCountdown(project.completionDate)}</strong>
        <small>Target completion: {formatDate(project.completionDate)}</small>
      </div>
    </section>
  );
}
