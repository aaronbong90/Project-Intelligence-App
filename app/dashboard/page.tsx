import { DashboardRouteClient } from "@/components/dashboard-route-client";
import { TopNav } from "@/components/top-nav";

export default function DashboardPage() {
  return (
    <div className="site-shell">
      <TopNav />
      <main className="dashboard-shell-page">
        <DashboardRouteClient />
      </main>
    </div>
  );
}
