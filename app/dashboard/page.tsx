import { DashboardShell } from "@/components/dashboard-shell";
import { TopNav } from "@/components/top-nav";
import { getProjectDashboardData } from "@/lib/projects";
import { getCurrentDateSnapshot } from "@/lib/utils";

export default async function DashboardPage() {
  const { projects, viewer } = await getProjectDashboardData();
  const todaySnapshot = getCurrentDateSnapshot();
  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return (
    <div className="site-shell">
      <TopNav />
      <main className="dashboard-shell-page">
        <DashboardShell initialProjects={projects} isConfigured={isConfigured} todaySnapshot={todaySnapshot} viewer={viewer} />
      </main>
    </div>
  );
}
