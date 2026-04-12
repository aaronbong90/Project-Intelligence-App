import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Field Hub Pro",
  description: "Multi-user construction project dashboard with handover, reporting, finance, and close-out workflows."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
