import { NextResponse, type NextRequest } from "next/server";
import { normalizeRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SubmissionRejectedPayload = {
  projectId?: string;
  submissionId?: string;
  recipientEmail?: string;
  projectName?: string;
  submissionTitle?: string;
  reviewerRole?: string;
  reviewNote?: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailHtml(input: {
  projectName: string;
  submissionTitle: string;
  reviewerRole: string;
  reviewNote: string;
}) {
  const projectName = escapeHtml(input.projectName);
  const submissionTitle = escapeHtml(input.submissionTitle);
  const reviewerRole = escapeHtml(input.reviewerRole);
  const reviewNote = escapeHtml(input.reviewNote);

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5">
      <h2 style="margin:0 0 12px">Submission rejected</h2>
      <p>A submission in <strong>${projectName}</strong> was rejected by ${reviewerRole}.</p>
      <p><strong>Submission:</strong> ${submissionTitle}</p>
      <p><strong>Review comment:</strong></p>
      <p style="padding:12px;border-left:4px solid #b45309;background:#fff7ed">${reviewNote}</p>
      <p>Please open ProjectAxis to review and resubmit the corrected document.</p>
    </div>
  `;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const payload = (await request.json()) as SubmissionRejectedPayload;
  const projectId = cleanText(payload.projectId, 80);
  const submissionId = cleanText(payload.submissionId, 80);
  const recipientEmail = cleanText(payload.recipientEmail, 254).toLowerCase();
  const projectName = cleanText(payload.projectName, 120) || "ProjectAxis project";
  const submissionTitle = cleanText(payload.submissionTitle, 160) || "Contractor submission";
  const reviewerRole = cleanText(payload.reviewerRole, 40) || "reviewer";
  const reviewNote = cleanText(payload.reviewNote, 1200);

  if (!isUuid(projectId) || !isUuid(submissionId)) {
    return NextResponse.json({ error: "A valid project and submission are required." }, { status: 400 });
  }

  if (!isEmail(recipientEmail)) {
    return NextResponse.json({ error: "A valid recipient email is required." }, { status: 400 });
  }

  if (!reviewNote) {
    return NextResponse.json({ error: "A review comment is required before sending a rejection email." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ emailSent: false, reason: "Supabase service credentials are missing." });
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, is_suspended")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (profile?.is_suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }

  const role = normalizeRole(profile?.role ?? "consultant");
  const [{ data: project }, { data: membership }, { data: submission, error: submissionError }] = await Promise.all([
    admin.from("projects").select("id, owner_id").eq("id", projectId).maybeSingle(),
    admin.from("project_members").select("id").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    admin
      .from("contractor_submissions")
      .select("id, owner_email, client_status, consultant_status")
      .eq("id", submissionId)
      .eq("project_id", projectId)
      .maybeSingle()
  ]);

  if (submissionError) {
    return NextResponse.json({ error: submissionError.message }, { status: 400 });
  }

  const hasProjectAccess = role === "master_admin" || project?.owner_id === user.id || Boolean(membership);
  if (!hasProjectAccess) {
    return NextResponse.json({ error: "You do not have access to this project." }, { status: 403 });
  }

  if (!submission) {
    return NextResponse.json({ error: "The rejected submission could not be found." }, { status: 404 });
  }

  if (submission.owner_email?.toLowerCase() !== recipientEmail) {
    return NextResponse.json({ error: "Rejection emails can only be sent to the submission owner." }, { status: 403 });
  }

  if (submission.client_status !== "rejected" && submission.consultant_status !== "rejected") {
    return NextResponse.json({ error: "This submission is not rejected." }, { status: 409 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.PROJECTAXIS_EMAIL_FROM;

  if (!resendApiKey || !emailFrom) {
    return NextResponse.json({ emailSent: false, reason: "Email provider is not configured." });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [recipientEmail],
      subject: `Submission rejected - ${projectName}`,
      html: buildEmailHtml({ projectName, submissionTitle, reviewerRole, reviewNote })
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: errorText || "Unable to send rejection email." }, { status: 502 });
  }

  return NextResponse.json({ emailSent: true });
}
