"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

export function ProjectCreateForm() {
  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    if (!isConfigured) {
      setError("Demo mode is active. Add Supabase credentials in .env.local to create cloud projects.");
      return;
    }

    const supabase = createClient();
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      location: String(formData.get("location") ?? "").trim(),
      client_name: String(formData.get("clientName") ?? "").trim(),
      contractor_name: String(formData.get("contractorName") ?? "").trim(),
      details: String(formData.get("details") ?? "").trim(),
      handover_date: String(formData.get("handoverDate") ?? "") || null,
      completion_date: String(formData.get("completionDate") ?? "") || null
    };

    setError(null);

    startTransition(async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Sign in first before creating a project.");
        return;
      }

      const { error: insertError } = await supabase.from("projects").insert({
        owner_id: user.id,
        ...payload
      });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      router.refresh();
    });
  }

  return (
    <section className="content-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">New Project</p>
          <h3>Create a cloud-synced project</h3>
        </div>
      </div>

      <form action={handleSubmit} className="project-form-grid">
        <label className="field">
          <span>Project name</span>
          <input name="name" placeholder="Example: Orchard Road refurbishment" required />
        </label>
        <label className="field">
          <span>Location</span>
          <input name="location" placeholder="Site address or unit" />
        </label>
        <label className="field">
          <span>Client</span>
          <input name="clientName" placeholder="Client name" />
        </label>
        <label className="field">
          <span>Contractor</span>
          <input name="contractorName" placeholder="Main contractor" />
        </label>
        <label className="field">
          <span>Handover date</span>
          <input name="handoverDate" type="date" />
        </label>
        <label className="field">
          <span>Completion date</span>
          <input name="completionDate" type="date" />
        </label>
        <label className="field field-full">
          <span>Project details</span>
          <textarea name="details" rows={4} placeholder="Scope, constraints, landlord conditions, authority notes..." />
        </label>
        <button className="primary-button" type="submit" disabled={isPending || !isConfigured}>
          {isPending ? "Creating..." : "Create project"}
        </button>
      </form>

      {!isConfigured ? <p className="form-message">This form activates automatically once Supabase is configured.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
