import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createFullModulePermissions } from "@/lib/auth";
import { demoProject } from "@/lib/demo-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import type { ProjectBundle } from "@/types/app";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let project: ProjectBundle = demoProject;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createAdminClient();
    const [{ data: overview }, { data: surveyItems }] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, location, client_name, contractor_name, details, handover_date, completion_date")
        .eq("id", projectId)
        .maybeSingle(),
      supabase
        .from("survey_items")
        .select("id, area, item, status, details")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
    ]);

    if (overview) {
      project = {
        overview: {
          id: overview.id,
          name: overview.name,
          location: overview.location ?? "",
          clientName: overview.client_name ?? "",
          contractorName: overview.contractor_name ?? "",
          details: overview.details ?? "",
          handoverDate: overview.handover_date,
          completionDate: overview.completion_date
        },
        access: {
          isOwner: true,
          canManageAccess: true,
          assignedRole: "master_admin",
          modules: createFullModulePermissions()
        },
        members: [],
        projectContractors: [],
        projectConsultants: [],
        milestones: [],
        contractorSubmissions: [],
        consultantSubmissions: [],
        surveyItems: (surveyItems ?? []).map((item) => ({
          id: item.id,
          area: item.area,
          item: item.item,
          status: item.status as ProjectBundle["surveyItems"][number]["status"],
          details: item.details ?? "",
          attachments: []
        })),
        dailyReports: [],
        weeklyReports: [],
        financialRecords: [],
        completionChecklist: [],
        defectZones: [],
        defects: [],
        notifications: []
      };
    }
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: 842,
    height: 595,
    color: rgb(0.04, 0.05, 0.1)
  });

  page.drawText("Dilapidation Report / Pre-Construction Survey", {
    x: 40,
    y: 540,
    size: 22,
    font: bold,
    color: rgb(0.94, 0.96, 1)
  });

  page.drawText(project.overview.name, {
    x: 40,
    y: 508,
    size: 16,
    font: bold,
    color: rgb(0.47, 0.74, 1)
  });

  const meta = [
    `Location: ${project.overview.location || "Not set"}`,
    `Client: ${project.overview.clientName || "Not set"}`,
    `Contractor: ${project.overview.contractorName || "Not set"}`,
    `Handover date: ${formatDate(project.overview.handoverDate)}`
  ];

  meta.forEach((line, index) => {
    page.drawText(line, {
      x: 40,
      y: 474 - index * 18,
      size: 11,
      font,
      color: rgb(0.79, 0.82, 0.94)
    });
  });

  page.drawText("Survey Items", {
    x: 40,
    y: 384,
    size: 14,
    font: bold,
    color: rgb(1, 0.69, 0.32)
  });

  project.surveyItems.slice(0, 7).forEach((item, index) => {
    const y = 356 - index * 40;
    page.drawText(`${index + 1}. ${item.area} - ${item.item}`, {
      x: 40,
      y,
      size: 11,
      font: bold,
      color: rgb(0.95, 0.96, 1)
    });
    page.drawText(`Status: ${item.status.replaceAll("_", " ")} | ${item.details.slice(0, 96)}`, {
      x: 52,
      y: y - 14,
      size: 9,
      font,
      color: rgb(0.75, 0.79, 0.93)
    });
  });

  const bytes = await pdf.save();
  const pdfBuffer = Buffer.from(bytes);

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${project.overview.name.replaceAll(" ", "-").toLowerCase()}-survey.pdf"`
    }
  });
}
