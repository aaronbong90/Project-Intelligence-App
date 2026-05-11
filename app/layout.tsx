import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ScrollRestoration } from "@/components/scroll-restoration";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "ProjectAxis",
  description: "Project intelligence for field teams, reporting, finance, handover, and close-out workflows."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={inter.variable} lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Suspense>
          <ScrollRestoration />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
