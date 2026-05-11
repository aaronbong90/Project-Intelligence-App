"use client";

import { useId } from "react";

type BrandClassProps = {
  className?: string;
};

export const PROJECT_AXIS_TAGLINE = "BUILD. EXECUTE. ACCELERATE.";

export function ProjectAxisMark({ className = "" }: BrandClassProps) {
  const gradientId = useId().replace(/:/g, "");
  const arcGradientId = `${gradientId}-arc`;
  const coreGradientId = `${gradientId}-core`;
  const glowId = `${gradientId}-glow`;

  return (
    <svg
      aria-hidden="true"
      className={`project-axis-mark-svg${className ? ` ${className}` : ""}`}
      viewBox="0 0 80 80"
    >
      <defs>
        <linearGradient id={arcGradientId} x1="14" x2="66" y1="14" y2="66">
          <stop offset="0%" stopColor="#7c5cff" />
          <stop offset="44%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#00d4ff" />
        </linearGradient>
        <radialGradient id={coreGradientId} cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="44%" stopColor="#e6e8ef" />
          <stop offset="100%" stopColor="#7c5cff" />
        </radialGradient>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path className="project-axis-mark-arc" d="M18 35A24 24 0 0 1 35 18" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-arc" d="M45 18A24 24 0 0 1 62 35" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-arc" d="M62 45A24 24 0 0 1 45 62" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-arc" d="M35 62A24 24 0 0 1 18 45" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-axis" d="M40 8v17" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-axis" d="M40 55v17" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-axis" d="M8 40h17" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-axis" d="M55 40h17" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-inner-axis" d="M40 29v5" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-inner-axis" d="M40 46v5" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-inner-axis" d="M29 40h5" stroke={`url(#${arcGradientId})`} />
      <path className="project-axis-mark-inner-axis" d="M46 40h5" stroke={`url(#${arcGradientId})`} />
      <circle className="project-axis-mark-core" cx="40" cy="40" r="9" fill={`url(#${coreGradientId})`} filter={`url(#${glowId})`} />
      <circle className="project-axis-mark-dot" cx="40" cy="8" r="3" fill={`url(#${coreGradientId})`} />
      <circle className="project-axis-mark-dot" cx="40" cy="72" r="3" fill={`url(#${coreGradientId})`} />
      <circle className="project-axis-mark-dot" cx="8" cy="40" r="3" fill={`url(#${coreGradientId})`} />
      <circle className="project-axis-mark-dot" cx="72" cy="40" r="3" fill={`url(#${coreGradientId})`} />
    </svg>
  );
}

export function ProjectAxisWordmark({ className = "" }: BrandClassProps) {
  return (
    <span className={`project-axis-wordmark${className ? ` ${className}` : ""}`}>
      <span className="project-axis-wordmark-project">Project</span>
      <strong className="project-axis-wordmark-axis">Axis</strong>
    </span>
  );
}
