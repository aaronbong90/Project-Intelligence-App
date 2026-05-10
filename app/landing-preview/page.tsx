import type { Metadata } from "next";
import { LandingPreviewClient } from "./landing-preview-client";

export const metadata: Metadata = {
  title: "ProjectAxis Landing Preview",
  description: "Modern ProjectAxis landing page preview."
};

export default function LandingPreviewPage() {
  return <LandingPreviewClient />;
}
