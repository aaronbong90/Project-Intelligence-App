import { Suspense } from "react";
import type { Metadata } from "next";
import { ScrollRestoration } from "@/components/scroll-restoration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Field Hub Pro",
  description: "Multi-user construction project dashboard with handover, reporting, finance, and close-out workflows."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Suspense>
          <ScrollRestoration />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
