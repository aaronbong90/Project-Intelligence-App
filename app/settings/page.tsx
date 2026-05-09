import { AdminShell } from "@/components/admin-shell";
import { TopNav } from "@/components/top-nav";
import { getAdminAccessData } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { viewer, isAllowed, users, projects } = await getAdminAccessData();
  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return (
    <div className="site-shell">
      <TopNav />
      <main className="dashboard-shell-page">
        <AdminShell
          initialUsers={users}
          isAllowed={isAllowed}
          isConfigured={isConfigured}
          projects={projects}
          viewer={viewer}
        />
      </main>
    </div>
  );
}
