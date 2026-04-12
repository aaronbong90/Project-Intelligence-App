"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  canReviewFinancialRecords,
  canSeeAllFinancialRecords,
  createFullModulePermissions,
  createModulePermissions,
  getRoleLabel,
  MODULE_KEYS,
  normalizeRole
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { PROJECT_FILES_BUCKET } from "@/lib/storage";
import { formatCountdown, formatCurrency, formatDate, formatDateTime, formatSectionLabel, sanitizeFilename } from "@/lib/utils";
import type {
  AttachmentRecord,
  AppUserProfile,
  ChecklistStatus,
  CompletionStatus,
  DefectRecord,
  DefectStatus,
  FinancialStatus,
  ModuleKey,
  ModulePermissions,
  ProjectMember,
  ProjectBundle,
  RecordSectionType
} from "@/types/app";

function emptyProject(name = ""): ProjectBundle {
  return {
    overview: {
      id: "",
      name,
      location: "",
      clientName: "",
      contractorName: "",
      details: "",
      handoverDate: null,
      completionDate: null
    },
    access: {
      isOwner: false,
      canManageAccess: false,
      assignedRole: "consultant",
      modules: createModulePermissions()
    },
    members: [],
    milestones: [],
    surveyItems: [],
    dailyReports: [],
    weeklyReports: [],
    financialRecords: [],
    completionChecklist: [],
    defectZones: [],
    defects: []
  };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AttachmentList({ attachments }: { attachments: AttachmentRecord[] }) {
  if (!attachments.length) {
    return <span className="pill">0 attachments</span>;
  }

  return (
    <div className="attachment-list">
      {attachments.map((attachment) => (
        <a
          className="attachment-link"
          href={attachment.publicUrl ?? "#"}
          key={attachment.id}
          rel="noreferrer"
          target="_blank"
        >
          {attachment.name}
        </a>
      ))}
    </div>
  );
}

function buildFinancialRecordFromRow(data: Record<string, unknown>, attachments: AttachmentRecord[]): ProjectBundle["financialRecords"][number] {
  return {
    id: String(data.id),
    documentType: data.document_type as ProjectBundle["financialRecords"][number]["documentType"],
    referenceNumber: String(data.reference_number ?? ""),
    amount: Number(data.amount ?? 0),
    status: data.status as FinancialStatus,
    notes: String(data.notes ?? ""),
    ownerUserId: String(data.owner_user_id ?? ""),
    ownerEmail: String(data.owner_email ?? ""),
    ownerRole: normalizeRole(typeof data.owner_role === "string" ? data.owner_role : undefined),
    submittedAt: typeof data.submitted_at === "string" ? data.submitted_at : null,
    reviewedAt: typeof data.reviewed_at === "string" ? data.reviewed_at : null,
    reviewedByUserId: typeof data.reviewed_by_user_id === "string" ? data.reviewed_by_user_id : null,
    reviewedByEmail: String(data.reviewed_by_email ?? ""),
    reviewNote: String(data.review_note ?? ""),
    attachments
  };
}

type Props = {
  initialProjects: ProjectBundle[];
  isConfigured: boolean;
  todaySnapshot: string;
  viewer: AppUserProfile | null;
};

export function DashboardShell({ initialProjects, isConfigured, todaySnapshot, viewer }: Props) {
  const [projects, setProjects] = useState<ProjectBundle[]>(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialProjects[0]?.overview.id ?? "");
  const [financialReviewNotes, setFinancialReviewNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeProject = useMemo(
    () => projects.find((project) => project.overview.id === activeProjectId) ?? projects[0] ?? emptyProject(),
    [activeProjectId, projects]
  );
  const isSuspended = viewer?.isSuspended ?? false;
  const moduleAccess = activeProject.access.modules;
  const currentProjectRole = activeProject.access.assignedRole;
  const canSeeAllVisibleFinancials = canSeeAllFinancialRecords(viewer?.role === "master_admin" ? "master_admin" : currentProjectRole);
  const canReviewVisibleFinancials = canReviewFinancialRecords(viewer?.role === "master_admin" ? "master_admin" : currentProjectRole);
  const canCreateFinancialRecords =
    Boolean(moduleAccess.financials && activeProject.overview.id) && (viewer?.role === "master_admin" || currentProjectRole !== "client");

  const approvedTotal = activeProject.financialRecords
    .filter((record) => record.status === "approved" || record.status === "paid")
    .reduce((sum, record) => sum + record.amount, 0);
  const overallTotal = activeProject.financialRecords.reduce((sum, record) => sum + record.amount, 0);
  const awaitingReviewTotal = activeProject.financialRecords
    .filter((record) => record.status === "submitted")
    .reduce((sum, record) => sum + record.amount, 0);
  const defectZoneNames = Array.from(
    new Set(
      [...activeProject.defectZones.map((zone) => zone.name), ...activeProject.defects.map((defect) => defect.zone).filter(Boolean)].sort((a, b) =>
        a.localeCompare(b)
      )
    )
  );
  const visibleModuleEntries = [
    { key: "overview", label: "Overview", href: "#overview" },
    { key: "handover", label: "Pre-Handover Survey", href: "#handover" },
    { key: "daily_reports", label: "Daily Reports", href: "#daily" },
    { key: "weekly_reports", label: "Weekly Reports", href: "#weekly" },
    { key: "financials", label: "Financials", href: "#financials" },
    { key: "completion", label: "Completion", href: "#completion" },
    { key: "defects", label: "Defects", href: "#defects" }
  ] satisfies Array<{ key: ModuleKey; label: string; href: string }>;

  const enabledModuleEntries = visibleModuleEntries.filter((entry) => moduleAccess[entry.key]);

  async function requireConfiguredAndUser() {
    if (!isConfigured) {
      throw new Error("Configure Supabase in .env.local to enable live project operations.");
    }

    if (isSuspended) {
      throw new Error("Your account is suspended. Contact the master admin to restore access.");
    }

    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("Sign in first before changing project data.");
    }

    return user;
  }

  function getConfiguredClient() {
    if (!isConfigured) {
      throw new Error("Configure Supabase in .env.local to enable live project operations.");
    }

    return createClient();
  }

  function resetMessages() {
    setError(null);
    setFeedback(null);
  }

  function normalizeZoneName(value: string) {
    return value.trim();
  }

  function normalizeDefectStatus(value: string): DefectStatus {
    const normalized = value.trim().toLowerCase().replaceAll(" ", "_");

    if (normalized === "in_progress" || normalized === "closed") {
      return normalized;
    }

    return "open";
  }

  function readImportedCell(row: Record<string, unknown>, candidates: string[]) {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value] as const);

    for (const candidate of candidates) {
      const match = normalizedEntries.find(([key]) => key === candidate);
      if (!match) continue;

      if (typeof match[1] === "string") {
        return match[1].trim();
      }

      if (typeof match[1] === "number") {
        return String(match[1]);
      }
    }

    return "";
  }

  function normalizeExcelImageExtension(extension: string) {
    const normalized = extension.trim().toLowerCase();

    if (normalized === "jpg") {
      return "jpeg";
    }

    if (normalized === "gif") {
      return "gif";
    }

    return "png";
  }

  function getExcelImageMimeType(extension: string) {
    return `image/${normalizeExcelImageExtension(extension)}`;
  }

  function toUint8Array(buffer: unknown) {
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }

    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    if (buffer && typeof buffer === "object" && "data" in buffer) {
      const data = (buffer as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return Uint8Array.from(data.filter((value): value is number => typeof value === "number"));
      }
    }

    return null;
  }

  function extractExcelImageFiles(
    worksheet: { getImages?: () => Array<{ imageId: string | number; range: { tl: { row: number } } }> },
    workbook: { model?: { media?: Array<{ type?: string; name?: string; extension?: string; buffer?: unknown }> } }
  ) {
    const imageFilesByRow = new Map<number, File[]>();
    const worksheetImages = typeof worksheet.getImages === "function" ? worksheet.getImages() : [];
    const workbookMedia = Array.isArray(workbook.model?.media) ? workbook.model.media : [];

    worksheetImages.forEach((image) => {
      const rowNumber = Math.floor(image.range?.tl?.row ?? -1) + 1;
      if (rowNumber <= 1) return;

      const mediaIndex = Number(image.imageId);
      const media = Number.isFinite(mediaIndex) ? workbookMedia[mediaIndex] : undefined;
      if (!media || media.type !== "image" || !media.extension) return;

      const bytes = toUint8Array(media.buffer);
      if (!bytes?.byteLength) return;

      const extension = normalizeExcelImageExtension(media.extension);
      const nextFiles = imageFilesByRow.get(rowNumber) ?? [];
      const fileBytes = Uint8Array.from(bytes);
      nextFiles.push(
        new File([fileBytes], `${media.name || `excel-photo-row-${rowNumber}-${nextFiles.length + 1}`}.${extension}`, {
          type: getExcelImageMimeType(extension)
        })
      );
      imageFilesByRow.set(rowNumber, nextFiles);
    });

    return imageFilesByRow;
  }

  function replaceProject(projectId: string, updater: (project: ProjectBundle) => ProjectBundle) {
    setProjects((current) => current.map((project) => (project.overview.id === projectId ? updater(project) : project)));
  }

  function setFinancialReviewNote(recordId: string, value: string) {
    setFinancialReviewNotes((current) => ({
      ...current,
      [recordId]: value
    }));
  }

  async function ensureDefectZone(projectId: string, zoneName: string) {
    const normalizedName = normalizeZoneName(zoneName);
    if (!normalizedName) return null;

    const existingZone = activeProject.defectZones.find((zone) => zone.name.toLowerCase() === normalizedName.toLowerCase());
    if (existingZone) {
      return existingZone;
    }

    const supabase = getConfiguredClient();
    const { data, error: insertError } = await supabase
      .from("defect_zones")
      .insert({
        project_id: projectId,
        name: normalizedName
      })
      .select("id, name")
      .single();

    if (insertError) {
      throw insertError;
    }

    const nextZone = {
      id: data.id,
      name: data.name
    };

    replaceProject(projectId, (project) => ({
      ...project,
      defectZones: [...project.defectZones, nextZone].sort((a, b) => a.name.localeCompare(b.name))
    }));

    return nextZone;
  }

  async function syncDefectZones(projectId: string, zoneNames: string[]) {
    const uniqueZoneNames = Array.from(new Set(zoneNames.map(normalizeZoneName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    if (!uniqueZoneNames.length) {
      return [];
    }

    const existingZonesByName = new Map(activeProject.defectZones.map((zone) => [zone.name.toLowerCase(), zone] as const));
    const missingZoneNames = uniqueZoneNames.filter((name) => !existingZonesByName.has(name.toLowerCase()));

    if (missingZoneNames.length) {
      const supabase = getConfiguredClient();
      const { data, error: upsertError } = await supabase
        .from("defect_zones")
        .upsert(
          missingZoneNames.map((name) => ({
            project_id: projectId,
            name
          })),
          { onConflict: "project_id,name" }
        )
        .select("id, name");

      if (upsertError) {
        throw upsertError;
      }

      if (data?.length) {
        replaceProject(projectId, (project) => {
          const merged = new Map(project.defectZones.map((zone) => [zone.name.toLowerCase(), zone] as const));
          data.forEach((zone) => {
            merged.set(zone.name.toLowerCase(), { id: zone.id, name: zone.name });
          });

          return {
            ...project,
            defectZones: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
          };
        });
      }
    }

    return uniqueZoneNames;
  }

  function mergeDefects(current: DefectRecord[], incoming: DefectRecord[]) {
    const merged = [...incoming];
    const seen = new Set(incoming.map((defect) => defect.id));

    current.forEach((defect) => {
      if (!seen.has(defect.id)) {
        merged.push(defect);
      }
    });

    return merged;
  }

  async function uploadAttachments(
    projectId: string,
    sectionType: RecordSectionType,
    recordId: string,
    files: File[]
  ): Promise<AttachmentRecord[]> {
    if (!files.length) return [];
    const supabase = getConfiguredClient();

    const uploaded: AttachmentRecord[] = [];

    for (const file of files) {
      const storagePath = `${projectId}/${sectionType}/${recordId}/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(PROJECT_FILES_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false
      });

      if (uploadError) {
        throw uploadError;
      }

      const { data: attachmentRow, error: attachmentError } = await supabase
        .from("attachments")
        .insert({
          project_id: projectId,
          section_type: sectionType,
          record_id: recordId,
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          storage_path: storagePath
        })
        .select("id, name, mime_type, storage_path")
        .single();

      if (attachmentError) {
        throw attachmentError;
      }

      const { data: publicUrlData } = supabase.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(storagePath);

      uploaded.push({
        id: attachmentRow.id,
        name: attachmentRow.name,
        mimeType: attachmentRow.mime_type,
        path: attachmentRow.storage_path,
        publicUrl: publicUrlData.publicUrl
      });
    }

    return uploaded;
  }

  async function deleteAttachments(recordId: string, sectionType: RecordSectionType) {
    const supabase = getConfiguredClient();
    const { data: rows, error: fetchError } = await supabase
      .from("attachments")
      .select("id, storage_path")
      .eq("record_id", recordId)
      .eq("section_type", sectionType);

    if (fetchError) {
      throw fetchError;
    }

    const paths = (rows ?? []).map((row) => row.storage_path);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(PROJECT_FILES_BUCKET).remove(paths);
      if (storageError) {
        throw storageError;
      }
    }

    const { error: deleteError } = await supabase
      .from("attachments")
      .delete()
      .eq("record_id", recordId)
      .eq("section_type", sectionType);

    if (deleteError) {
      throw deleteError;
    }
  }

  function handleProjectCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const user = await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          owner_id: user.id,
          name: String(formData.get("name") ?? "").trim(),
          location: String(formData.get("location") ?? "").trim(),
          client_name: String(formData.get("clientName") ?? "").trim(),
          contractor_name: String(formData.get("contractorName") ?? "").trim(),
          details: String(formData.get("details") ?? "").trim(),
          handover_date: String(formData.get("handoverDate") ?? "") || null,
          completion_date: String(formData.get("completionDate") ?? "") || null
        };

        const { data, error: insertError } = await supabase
          .from("projects")
          .insert(payload)
          .select("id, name, location, client_name, contractor_name, details, handover_date, completion_date")
          .single();

        if (insertError) throw insertError;

        const nextProject: ProjectBundle = {
          overview: {
            id: data.id,
            name: data.name,
            location: data.location ?? "",
            clientName: data.client_name ?? "",
            contractorName: data.contractor_name ?? "",
            details: data.details ?? "",
            handoverDate: data.handover_date,
            completionDate: data.completion_date
          },
          access: {
            isOwner: true,
            canManageAccess: viewer?.role === "master_admin",
            assignedRole: viewer?.role ?? "consultant",
            modules: createFullModulePermissions()
          },
          members: [],
          milestones: [],
          surveyItems: [],
          dailyReports: [],
          weeklyReports: [],
          financialRecords: [],
          completionChecklist: [],
          defectZones: [],
          defects: []
        };

        setProjects((current) => [nextProject, ...current]);
        setActiveProjectId(nextProject.overview.id);
        setFeedback("Project created.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to create project.");
      }
    });
  }

  function handleOverviewUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          name: String(formData.get("name") ?? "").trim(),
          location: String(formData.get("location") ?? "").trim(),
          client_name: String(formData.get("clientName") ?? "").trim(),
          contractor_name: String(formData.get("contractorName") ?? "").trim(),
          details: String(formData.get("details") ?? "").trim(),
          handover_date: String(formData.get("handoverDate") ?? "") || null,
          completion_date: String(formData.get("completionDate") ?? "") || null
        };

        const { error: updateError } = await supabase.from("projects").update(payload).eq("id", activeProject.overview.id);
        if (updateError) throw updateError;

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          overview: {
            ...project.overview,
            name: payload.name,
            location: payload.location,
            clientName: payload.client_name,
            contractorName: payload.contractor_name,
            details: payload.details,
            handoverDate: payload.handover_date,
            completionDate: payload.completion_date
          }
        }));
        setFeedback("Project overview updated.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update project.");
      }
    });
  }

  function handleMilestoneCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          project_id: activeProject.overview.id,
          title: String(formData.get("title") ?? "").trim(),
          due_date: String(formData.get("dueDate") ?? "")
        };

        const { data, error: insertError } = await supabase
          .from("milestones")
          .insert(payload)
          .select("id, title, due_date")
          .single();

        if (insertError) throw insertError;

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          milestones: [...project.milestones, { id: data.id, title: data.title, dueDate: data.due_date }].sort((a, b) =>
            a.dueDate.localeCompare(b.dueDate)
          )
        }));
        setFeedback("Milestone added.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to add milestone.");
      }
    });
  }

  function handleRecordCreate<
    Section extends RecordSectionType,
    TableRow extends Record<string, string | number | null>
  >(
    event: React.FormEvent<HTMLFormElement>,
    options: {
      table: string;
      section: Section;
      buildPayload: (formData: FormData) => Promise<TableRow> | TableRow;
      select: string;
      append: (project: ProjectBundle, data: Record<string, unknown>, attachments: AttachmentRecord[]) => ProjectBundle;
    }
  ) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          project_id: activeProject.overview.id,
          ...(await options.buildPayload(formData))
        };

        const { data, error: insertError } = await supabase.from(options.table).insert(payload).select(options.select).single();
        if (insertError) throw insertError;
        const row = data as unknown as Record<string, unknown> | null;
        if (!row) {
          throw new Error("The record was created but no response row was returned.");
        }

        const attachments = await uploadAttachments(activeProject.overview.id, options.section, String(row.id), files);
        replaceProject(activeProject.overview.id, (project) => options.append(project, row, attachments));
        setFeedback(`${formatSectionLabel(options.section)} created.`);
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to create record.");
      }
    });
  }

  function handleDelete(options: {
    table: string;
    recordId: string;
    section?: RecordSectionType;
    remove: (project: ProjectBundle) => ProjectBundle;
  }) {
    resetMessages();
    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        if (options.section) {
          await deleteAttachments(options.recordId, options.section);
        }
        const { error: deleteError } = await supabase.from(options.table).delete().eq("id", options.recordId);
        if (deleteError) throw deleteError;

        replaceProject(activeProject.overview.id, options.remove);
        setFeedback("Record deleted.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to delete record.");
      }
    });
  }

  function handleFinancialStatusUpdate(record: ProjectBundle["financialRecords"][number], nextStatus: FinancialStatus) {
    resetMessages();

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();

        const reviewNote = (financialReviewNotes[record.id] ?? "").trim();
        if (nextStatus === "rejected" && !reviewNote) {
          throw new Error("Add a rejection reason before rejecting this submission.");
        }

        const supabase = getConfiguredClient();
        const payload: Record<string, string | null> = {
          status: nextStatus,
          review_note:
            nextStatus === "submitted"
              ? null
              : reviewNote || record.reviewNote || null
        };

        const { data, error: updateError } = await supabase
          .from("financial_records")
          .update(payload)
          .eq("id", record.id)
          .select(
            "id, document_type, reference_number, amount, status, notes, owner_user_id, owner_email, owner_role, submitted_at, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note"
          )
          .single();

        if (updateError) {
          throw updateError;
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          financialRecords: project.financialRecords.map((item) =>
            item.id === record.id ? buildFinancialRecordFromRow(data, item.attachments) : item
          )
        }));
        setFinancialReviewNotes((current) => {
          const next = { ...current };
          delete next[record.id];
          return next;
        });

        const statusMessages: Record<FinancialStatus, string> = {
          pending: "Financial draft saved.",
          submitted: "Financial submission sent for client review.",
          approved: "Financial submission approved.",
          rejected: "Financial submission rejected with client comments.",
          paid: "Financial submission marked as paid."
        };

        setFeedback(statusMessages[nextStatus]);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the financial status.");
      }
    });
  }

  function handleDefectZoneCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const zoneName = normalizeZoneName(String(formData.get("zoneName") ?? ""));
        if (!zoneName) {
          throw new Error("Enter a zone name before saving.");
        }

        await ensureDefectZone(activeProject.overview.id, zoneName);
        setFeedback("Defect zone saved.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to save defect zone.");
      }
    });
  }

  function handleDefectTemplateDownload() {
    resetMessages();

    startTransition(async () => {
      try {
        const ExcelJS = await import("exceljs");
        const templateRows = [
          {
            zone: "Pantry",
            defectTitle: "Silicone joint gap at backsplash",
            status: "open",
            details: "Observed during internal pre-handover inspection. Requires reseal."
          },
          {
            zone: "Front-of-house",
            defectTitle: "Paint touch-up beside entrance return wall",
            status: "in_progress",
            details: "Minor scuff marks visible after fit-out protection removal."
          }
        ];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Defects");
        worksheet.columns = [
          { header: "Zone", key: "zone", width: 24 },
          { header: "Defect Title", key: "defectTitle", width: 40 },
          { header: "Status", key: "status", width: 18 },
          { header: "Details", key: "details", width: 56 },
          { header: "Photo", key: "photo", width: 22 }
        ];
        templateRows.forEach((row) =>
          worksheet.addRow({
            ...row,
            photo: "Insert image anchored on this row"
          })
        );
        worksheet.getRow(2).height = 72;
        worksheet.getRow(3).height = 72;

        const instructions = workbook.addWorksheet("Instructions");
        instructions.columns = [{ header: "How to use", key: "instruction", width: 110 }];
        instructions.addRows([
          { instruction: "Keep row 1 as the header row." },
          { instruction: "Enter each defect on its own row using Zone, Defect Title, Status, and Details." },
          { instruction: "To import a photo, insert it into the Photo column on the same defect row. The app matches embedded Excel images by row." },
          { instruction: "Save the file as .xlsx or .xlsm before importing." }
        ]);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "project-field-hub-defect-template.xlsx";
        link.click();
        URL.revokeObjectURL(url);
        setFeedback("Excel defect template downloaded.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to generate the defect template.");
      }
    });
  }

  function handleDefectImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("defectImport");

    startTransition(async () => {
      try {
        if (!(file instanceof File) || file.size === 0) {
          throw new Error("Choose an Excel file before importing.");
        }

        await requireConfiguredAndUser();
        const ExcelJS = await import("exceljs");
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
          throw new Error("The workbook is empty.");
        }

        const imageFilesByRow = extractExcelImageFiles(worksheet, workbook);
        const headerRow = worksheet.getRow(1);
        const headers = (Array.isArray(headerRow.values) ? headerRow.values.slice(1) : []).map((value) =>
          String(value ?? "")
            .trim()
            .toLowerCase()
        );

        const rows: Array<{ rowNumber: number; values: Record<string, unknown> }> = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber === 1) return;

          const values: Record<string, unknown> = {};
          headers.forEach((header, index) => {
            if (!header) return;
            values[header] = row.getCell(index + 1).text?.trim() ?? "";
          });
          rows.push({ rowNumber, values });
        });

        const importedRows = rows
          .map(({ rowNumber, values }) => {
            const zone = normalizeZoneName(readImportedCell(values, ["zone", "area", "location"]));
            const title = readImportedCell(values, ["defect title", "title", "defect", "issue"]);
            const status = normalizeDefectStatus(readImportedCell(values, ["status"]));
            const details = readImportedCell(values, ["details", "description", "remarks", "comment"]);
            const imageFiles = imageFilesByRow.get(rowNumber) ?? [];

            return { rowNumber, zone, title, status, details, imageFiles };
          })
          .filter((row) => row.zone && row.title);

        const skippedRows = rows.length - importedRows.length;

        if (!importedRows.length) {
          throw new Error("No valid defect rows were found. Use columns like Zone, Defect Title, Status, and Details.");
        }

        await syncDefectZones(
          activeProject.overview.id,
          importedRows.map((row) => row.zone)
        );

        const supabase = getConfiguredClient();
        const createdDefects: DefectRecord[] = [];
        let uploadedImageCount = 0;
        let imageUploadFailureRows = 0;

        for (const row of importedRows) {
          const { data, error: insertError } = await supabase
            .from("defects")
            .insert({
              project_id: activeProject.overview.id,
              zone: row.zone,
              title: row.title,
              status: row.status,
              details: row.details
            })
            .select("id, zone, title, status, details")
            .single();

          if (insertError) {
            throw insertError;
          }

          let attachments: AttachmentRecord[] = [];
          if (row.imageFiles.length) {
            try {
              attachments = await uploadAttachments(activeProject.overview.id, "defect", data.id, row.imageFiles);
              uploadedImageCount += attachments.length;
            } catch (attachmentError) {
              imageUploadFailureRows += 1;
              console.error(`Unable to upload Excel images for defect row ${row.rowNumber}.`, attachmentError);
            }
          }

          createdDefects.push({
            id: data.id,
            zone: data.zone ?? "",
            title: data.title,
            status: data.status as DefectStatus,
            details: data.details ?? "",
            attachments
          });
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          defects: mergeDefects(project.defects, createdDefects)
        }));

        setFeedback(
          `Imported ${importedRows.length} defect${importedRows.length === 1 ? "" : "s"}${
            skippedRows > 0 ? ` and skipped ${skippedRows} incomplete row${skippedRows === 1 ? "" : "s"}` : ""
          }${
            uploadedImageCount > 0 ? `, including ${uploadedImageCount} embedded photo${uploadedImageCount === 1 ? "" : "s"}` : ""
          }${
            imageUploadFailureRows > 0
              ? `. ${imageUploadFailureRows} row${imageUploadFailureRows === 1 ? "" : "s"} had photo upload issues`
              : "."
          }`
        );
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to import the defect register.");
      }
    });
  }

  function buildPermissionsFromFormData(formData: FormData): ModulePermissions {
    return createModulePermissions({
      overview: formData.get("overview") === "on",
      handover: formData.get("handover") === "on",
      daily_reports: formData.get("daily_reports") === "on",
      weekly_reports: formData.get("weekly_reports") === "on",
      financials: formData.get("financials") === "on",
      completion: formData.get("completion") === "on",
      defects: formData.get("defects") === "on"
    });
  }

  function handleMembershipSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        if (viewer?.role !== "master_admin") {
          throw new Error("Only the master admin can manage access roles.");
        }

        const supabase = getConfiguredClient();
        const email = String(formData.get("email") ?? "").trim().toLowerCase();
        const role = String(formData.get("role") ?? "consultant") as AppUserProfile["role"];
        const modules = buildPermissionsFromFormData(formData);

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, email, role")
          .eq("email", email)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!profile) {
          throw new Error("That user must sign up first before you can assign project access.");
        }

        if (profile.role !== role) {
          const { error: profileUpdateError } = await supabase.from("profiles").update({ role }).eq("id", profile.id);
          if (profileUpdateError) throw profileUpdateError;
        }

        const membershipPayload = {
          project_id: activeProject.overview.id,
          user_id: profile.id,
          email,
          role,
          can_overview: modules.overview,
          can_handover: modules.handover,
          can_daily_reports: modules.daily_reports,
          can_weekly_reports: modules.weekly_reports,
          can_financials: modules.financials,
          can_completion: modules.completion,
          can_defects: modules.defects
        };

        const { data: membershipRow, error: membershipError } = await supabase
          .from("project_members")
          .upsert(membershipPayload, { onConflict: "project_id,user_id" })
          .select(
            "id, project_id, user_id, email, role, can_overview, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects"
          )
          .single();

        if (membershipError) throw membershipError;

        const nextMember: ProjectMember = {
          id: membershipRow.id,
          userId: membershipRow.user_id,
          email: membershipRow.email,
          role: membershipRow.role,
          modules
        };

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          members: [...project.members.filter((member) => member.userId !== nextMember.userId), nextMember].sort((a, b) =>
            a.email.localeCompare(b.email)
          )
        }));
        setFeedback("Project access updated.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to save project access.");
      }
    });
  }

  function handleMembershipDelete(memberId: string, userId: string) {
    resetMessages();
    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        if (viewer?.role !== "master_admin") {
          throw new Error("Only the master admin can remove project access.");
        }

        const supabase = getConfiguredClient();
        const { error: deleteError } = await supabase.from("project_members").delete().eq("id", memberId);
        if (deleteError) throw deleteError;

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          members: project.members.filter((member) => member.id !== memberId),
          access:
            userId === viewer.id
              ? {
                  ...project.access,
                  modules: createModulePermissions()
                }
              : project.access
        }));
        setFeedback("Project access removed.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to remove access.");
      }
    });
  }

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy-block">
          <p className="eyebrow">Active Project</p>
          <h2>{activeProject.overview.name || "Create your first project"}</h2>
          <p className="hero-description">
            {activeProject.overview.details || "Store handover, reporting, finance, and defects in one live project workspace."}
          </p>
          {viewer ? (
            <div className="viewer-banner">
              <span className="pill">{getRoleLabel(viewer.role, viewer.email)}</span>
              <span className="muted-copy">
                Signed in as {viewer.email || "current user"}
                {viewer.role === "master_admin" ? ". You can see and manage all projects and permissions." : ". Your module access is controlled per project."}
              </span>
            </div>
          ) : null}
          <div className="hero-meta-grid">
            <div>
              <span>Location</span>
              <strong>{activeProject.overview.location || "Not set"}</strong>
            </div>
            <div>
              <span>Client</span>
              <strong>{activeProject.overview.clientName || "Not set"}</strong>
            </div>
            <div>
              <span>Contractor</span>
              <strong>{activeProject.overview.contractorName || "Not set"}</strong>
            </div>
            <div>
              <span>Handover</span>
              <strong>{formatDate(activeProject.overview.handoverDate)}</strong>
            </div>
          </div>
        </div>
        <div className="countdown-card">
          <span>Countdown</span>
          <strong>{formatCountdown(activeProject.overview.completionDate, todaySnapshot)}</strong>
          <small>Target completion: {formatDate(activeProject.overview.completionDate)}</small>
        </div>
      </section>

      <section className="content-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Projects</p>
            <h3>{viewer?.role === "master_admin" ? "Create and switch projects" : "Your accessible projects"}</h3>
          </div>
        </div>

        {viewer?.role === "master_admin" || !viewer ? (
          <form className="project-form-grid" onSubmit={handleProjectCreate}>
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
            <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
              {isPending ? "Saving..." : "Create project"}
            </button>
          </form>
        ) : null}

        <div className="project-chip-row">
          {projects.map((project) => (
            <button
              className={`project-chip ${project.overview.id === activeProject.overview.id ? "active" : ""}`}
              key={project.overview.id}
              onClick={() => setActiveProjectId(project.overview.id)}
              type="button"
            >
              {project.overview.name}
            </button>
          ))}
        </div>
      </section>

      {!isConfigured ? (
        <p className="form-message">Demo mode is active. Add Supabase credentials to enable live CRUD and uploads.</p>
      ) : null}
      {feedback ? <p className="form-message">{feedback}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {isSuspended ? (
        <section className="content-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Access Paused</p>
              <h3>Your account is currently suspended</h3>
            </div>
          </div>
          <p className="muted-copy">
            Login is still active, but project records and module access are blocked until your master admin reactivates this account.
          </p>
        </section>
      ) : null}

      {!isSuspended ? <div className="dashboard-grid">
        <aside className="dashboard-sidebar panel-surface">
          <div>
            <p className="eyebrow">Modules</p>
            <h3>Project Controls</h3>
          </div>
          <span className="pill">{getRoleLabel(activeProject.access.assignedRole, viewer?.email)}</span>
          {viewer?.role === "master_admin" ? <span className="pill">Master controls enabled</span> : null}
          <div className="nav-stack">
            {enabledModuleEntries.map((entry) => (
              <a href={entry.href} key={entry.key}>
                {entry.label}
              </a>
            ))}
          </div>
          <div className="sidebar-cta">
            <p className="muted-copy">Generate branded PDF reports and sync team updates across devices.</p>
            {activeProject.overview.id ? (
              <Link className="secondary-button" href={`/api/projects/${activeProject.overview.id}/reports/dilapidation`}>
                Download survey PDF
              </Link>
            ) : null}
          </div>
        </aside>

        <main className="dashboard-main">
          {moduleAccess.overview ? (
            <section className="content-card" id="overview">
            <div className="section-header">
              <div>
                <p className="eyebrow">Overview</p>
                <h3>Project summary and timeline</h3>
              </div>
            </div>
            <div className="stats-grid">
              <StatCard label="Milestones" value={String(activeProject.milestones.length)} />
              <StatCard label="Daily Reports" value={String(activeProject.dailyReports.length)} />
              <StatCard label="Survey Items" value={String(activeProject.surveyItems.length)} />
              <StatCard label="Approved Value" value={formatCurrency(approvedTotal)} />
            </div>
            <form className="project-form-grid top-gap" onSubmit={handleOverviewUpdate}>
              <label className="field">
                <span>Project name</span>
                <input defaultValue={activeProject.overview.name} key={`${activeProject.overview.id}-name`} name="name" required />
              </label>
              <label className="field">
                <span>Location</span>
                <input defaultValue={activeProject.overview.location} key={`${activeProject.overview.id}-location`} name="location" />
              </label>
              <label className="field">
                <span>Client</span>
                <input defaultValue={activeProject.overview.clientName} key={`${activeProject.overview.id}-client`} name="clientName" />
              </label>
              <label className="field">
                <span>Contractor</span>
                <input
                  defaultValue={activeProject.overview.contractorName}
                  key={`${activeProject.overview.id}-contractor`}
                  name="contractorName"
                />
              </label>
              <label className="field">
                <span>Handover date</span>
                <input
                  defaultValue={activeProject.overview.handoverDate ?? ""}
                  key={`${activeProject.overview.id}-handover`}
                  name="handoverDate"
                  type="date"
                />
              </label>
              <label className="field">
                <span>Completion date</span>
                <input
                  defaultValue={activeProject.overview.completionDate ?? ""}
                  key={`${activeProject.overview.id}-completion`}
                  name="completionDate"
                  type="date"
                />
              </label>
              <label className="field field-full">
                <span>Project details</span>
                <textarea
                  defaultValue={activeProject.overview.details}
                  key={`${activeProject.overview.id}-details`}
                  name="details"
                  rows={4}
                />
              </label>
              <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                {isPending ? "Saving..." : "Save overview"}
              </button>
            </form>

            <form className="inline-create-form top-gap" onSubmit={handleMilestoneCreate}>
              <label className="field">
                <span>Milestone</span>
                <input name="title" placeholder="Authority submission" required />
              </label>
              <label className="field">
                <span>Date</span>
                <input name="dueDate" type="date" required />
              </label>
              <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Add milestone
              </button>
            </form>

            <div className="list-grid top-gap">
              {activeProject.milestones.map((milestone) => (
                <article className="record-surface" key={milestone.id}>
                  <div className="record-header">
                    <div>
                      <strong>{milestone.title}</strong>
                      <p>{formatDate(milestone.dueDate)}</p>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        handleDelete({
                          table: "milestones",
                          recordId: milestone.id,
                          remove: (project) => ({
                            ...project,
                            milestones: project.milestones.filter((item) => item.id !== milestone.id)
                          })
                        })
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {moduleAccess.handover ? (
            <section className="content-card" id="handover">
            <div className="section-header">
              <div>
                <p className="eyebrow">Client to Contractor</p>
                <h3>Pre-Handover Survey / Dilapidation</h3>
              </div>
            </div>
            <form
              className="module-form-grid"
              onSubmit={(event) =>
                handleRecordCreate(event, {
                  table: "survey_items",
                  section: "survey_item",
                  buildPayload: (formData) => ({
                    area: String(formData.get("area") ?? "").trim(),
                    item: String(formData.get("item") ?? "").trim(),
                    status: String(formData.get("status") ?? "good") as ChecklistStatus,
                    details: String(formData.get("details") ?? "").trim()
                  }),
                  select: "id, area, item, status, details",
                  append: (project, data, attachments) => ({
                    ...project,
                    surveyItems: [
                      {
                        id: String(data.id),
                        area: String(data.area),
                        item: String(data.item),
                        status: data.status as ChecklistStatus,
                        details: String(data.details ?? ""),
                        attachments
                      },
                      ...project.surveyItems
                    ]
                  })
                })
              }
            >
              <label className="field">
                <span>Area / location</span>
                <input name="area" placeholder="Existing kitchen exhaust riser" required />
              </label>
              <label className="field">
                <span>Checklist item</span>
                <input name="item" placeholder="Wall, slab, M&E points, fixtures" required />
              </label>
              <label className="field">
                <span>Status</span>
                <select name="status">
                  <option value="good">Good</option>
                  <option value="minor_issue">Minor issue</option>
                  <option value="major_issue">Major issue</option>
                  <option value="missing">Missing</option>
                </select>
              </label>
              <label className="field field-full">
                <span>Recorded details</span>
                <textarea name="details" rows={3} />
              </label>
              <label className="field field-full">
                <span>Photo / video attachments</span>
                <input accept="image/*,video/*" multiple name="attachments" type="file" />
              </label>
              <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Add survey item
              </button>
            </form>
            <div className="list-grid top-gap">
              {activeProject.surveyItems.map((item) => (
                <article className="record-surface" key={item.id}>
                  <div className="record-header">
                    <div>
                      <strong>{item.area}</strong>
                      <p>{item.item}</p>
                    </div>
                    <div className="record-actions">
                      <span className="pill">{formatSectionLabel(item.status)}</span>
                      <button
                        className="ghost-button"
                        onClick={() =>
                          handleDelete({
                            table: "survey_items",
                            recordId: item.id,
                            section: "survey_item",
                            remove: (project) => ({
                              ...project,
                              surveyItems: project.surveyItems.filter((survey) => survey.id !== item.id)
                            })
                          })
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="muted-copy">{item.details}</p>
                  <AttachmentList attachments={item.attachments} />
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {moduleAccess.daily_reports ? (
            <section className="content-card" id="daily">
            <div className="section-header">
              <div>
                <p className="eyebrow">Contractor Records</p>
                <h3>Daily Reports</h3>
              </div>
            </div>
            <form
              className="module-form-grid"
              onSubmit={(event) =>
                handleRecordCreate(event, {
                  table: "daily_reports",
                  section: "daily_report",
                  buildPayload: (formData) => ({
                    report_date: String(formData.get("reportDate") ?? ""),
                    location: String(formData.get("location") ?? "").trim(),
                    work_done: String(formData.get("workDone") ?? "").trim(),
                    manpower_by_trade: String(formData.get("manpowerByTrade") ?? "").trim()
                  }),
                  select: "id, report_date, location, work_done, manpower_by_trade",
                  append: (project, data, attachments) => ({
                    ...project,
                    dailyReports: [
                      {
                        id: String(data.id),
                        reportDate: String(data.report_date),
                        location: String(data.location),
                        workDone: String(data.work_done ?? ""),
                        manpowerByTrade: String(data.manpower_by_trade ?? ""),
                        attachments
                      },
                      ...project.dailyReports
                    ]
                  })
                })
              }
            >
              <label className="field">
                <span>Date</span>
                <input name="reportDate" type="date" required />
              </label>
              <label className="field">
                <span>Project / location</span>
                <input name="location" placeholder="Main site" required />
              </label>
              <label className="field field-full">
                <span>Work completed today</span>
                <textarea name="workDone" rows={3} />
              </label>
              <label className="field field-full">
                <span>Manpower by trade</span>
                <textarea name="manpowerByTrade" rows={3} placeholder="Carpentry: 4, Electrical: 2" />
              </label>
              <label className="field field-full">
                <span>Photo / video attachments</span>
                <input accept="image/*,video/*" multiple name="attachments" type="file" />
              </label>
              <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Add daily report
              </button>
            </form>
            <div className="list-grid top-gap">
              {activeProject.dailyReports.map((report) => (
                <article className="record-surface" key={report.id}>
                  <div className="record-header">
                    <div>
                      <strong>{formatDate(report.reportDate)}</strong>
                      <p>{report.location}</p>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        handleDelete({
                          table: "daily_reports",
                          recordId: report.id,
                          section: "daily_report",
                          remove: (project) => ({
                            ...project,
                            dailyReports: project.dailyReports.filter((item) => item.id !== report.id)
                          })
                        })
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                  <p>{report.workDone}</p>
                  <p className="muted-copy">{report.manpowerByTrade}</p>
                  <AttachmentList attachments={report.attachments} />
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {moduleAccess.weekly_reports ? (
            <section className="content-card" id="weekly">
            <div className="section-header">
              <div>
                <p className="eyebrow">Programme Summary</p>
                <h3>Weekly Reports</h3>
              </div>
            </div>
            <form
              className="module-form-grid"
              onSubmit={(event) =>
                handleRecordCreate(event, {
                  table: "weekly_reports",
                  section: "weekly_report",
                  buildPayload: (formData) => ({
                    week_ending: String(formData.get("weekEnding") ?? ""),
                    summary: String(formData.get("summary") ?? "").trim()
                  }),
                  select: "id, week_ending, summary",
                  append: (project, data, attachments) => ({
                    ...project,
                    weeklyReports: [
                      {
                        id: String(data.id),
                        weekEnding: String(data.week_ending),
                        summary: String(data.summary ?? ""),
                        attachments
                      },
                      ...project.weeklyReports
                    ]
                  })
                })
              }
            >
              <label className="field">
                <span>Week ending</span>
                <input name="weekEnding" type="date" required />
              </label>
              <label className="field field-full">
                <span>Summary</span>
                <textarea name="summary" rows={3} />
              </label>
              <label className="field field-full">
                <span>Attachments</span>
                <input accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" multiple name="attachments" type="file" />
              </label>
              <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Add weekly report
              </button>
            </form>
            <div className="list-grid top-gap">
              {activeProject.weeklyReports.map((report) => (
                <article className="record-surface" key={report.id}>
                  <div className="record-header">
                    <strong>Week ending {formatDate(report.weekEnding)}</strong>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        handleDelete({
                          table: "weekly_reports",
                          recordId: report.id,
                          section: "weekly_report",
                          remove: (project) => ({
                            ...project,
                            weeklyReports: project.weeklyReports.filter((item) => item.id !== report.id)
                          })
                        })
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                  <p>{report.summary}</p>
                  <AttachmentList attachments={report.attachments} />
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {moduleAccess.financials ? (
            <section className="content-card" id="financials">
            <div className="section-header">
              <div>
                <p className="eyebrow">Commercial Control</p>
                <h3>Financial Register</h3>
                <p className="muted-copy">
                  {canSeeAllVisibleFinancials
                    ? "You can review every financial submission on this project."
                    : "Only the quotations, invoices, and variation orders submitted from your own account are visible here."}
                </p>
              </div>
            </div>
            <div className="stats-grid compact">
              <StatCard label="Total Visible" value={formatCurrency(overallTotal)} />
              <StatCard label="Awaiting Client" value={formatCurrency(awaitingReviewTotal)} />
              <StatCard label="Approved / Paid" value={formatCurrency(approvedTotal)} />
            </div>
            {canCreateFinancialRecords ? (
              <form
                className="module-form-grid"
                onSubmit={(event) =>
                  handleRecordCreate(event, {
                    table: "financial_records",
                    section: "financial_record",
                    buildPayload: (formData) => ({
                      document_type: String(formData.get("documentType") ?? "quotation"),
                      reference_number: String(formData.get("referenceNumber") ?? "").trim(),
                      amount: Number(formData.get("amount") ?? 0),
                      status: "pending" as FinancialStatus,
                      notes: String(formData.get("notes") ?? "").trim(),
                      owner_user_id: viewer?.id ?? "",
                      owner_email: viewer?.email ?? "",
                      owner_role: viewer?.role === "master_admin" ? "master_admin" : currentProjectRole
                    }),
                    select:
                      "id, document_type, reference_number, amount, status, notes, owner_user_id, owner_email, owner_role, submitted_at, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note",
                    append: (project, data, attachments) => ({
                      ...project,
                      financialRecords: [buildFinancialRecordFromRow(data, attachments), ...project.financialRecords]
                    })
                  })
                }
              >
                <label className="field">
                  <span>Document type</span>
                  <select name="documentType">
                    <option value="quotation">Quotation</option>
                    <option value="invoice">Invoice</option>
                    <option value="variation_order">Variation order</option>
                  </select>
                </label>
                <label className="field">
                  <span>Reference no.</span>
                  <input name="referenceNumber" />
                </label>
                <label className="field">
                  <span>Amount</span>
                  <input min="0" name="amount" step="0.01" type="number" />
                </label>
                <label className="field field-full">
                  <span>Notes</span>
                  <textarea name="notes" rows={3} placeholder="Scope notes, breakdown remarks, or commercial clarifications..." />
                </label>
                <label className="field field-full">
                  <span>Attachments</span>
                  <input accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" multiple name="attachments" type="file" />
                </label>
                <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Save financial draft
                </button>
              </form>
            ) : (
              <div className="panel-surface top-gap">
                <p className="muted-copy">
                  Client reviewers can see every submission and decide whether to approve, reject, or mark approved records as paid.
                </p>
              </div>
            )}
            <div className="list-grid top-gap">
              {activeProject.financialRecords.map((record) => (
                <article className="record-surface" key={record.id}>
                  {(() => {
                    const viewerId = viewer?.id ?? "";
                    const isOwnSubmission = Boolean(viewerId) && record.ownerUserId === viewerId;
                    const canDeleteSubmission = viewer?.role === "master_admin" || (isOwnSubmission && (record.status === "pending" || record.status === "rejected"));
                    const canSubmitSubmission = isOwnSubmission && (record.status === "pending" || record.status === "rejected");
                    const canApproveSubmission = canReviewVisibleFinancials && record.status === "submitted";
                    const canMarkPaid = canReviewVisibleFinancials && record.status === "approved";
                    const reviewDraft = financialReviewNotes[record.id] ?? "";

                    return (
                      <>
                        <div className="record-header">
                          <div>
                            <strong>{formatSectionLabel(record.documentType)}</strong>
                            <p>{record.referenceNumber || "No reference number"}</p>
                          </div>
                          <div className="record-actions">
                            <span className="pill">{formatSectionLabel(record.status)}</span>
                            {canSubmitSubmission ? (
                              <button
                                className="secondary-button"
                                disabled={isPending || !isConfigured}
                                onClick={() => handleFinancialStatusUpdate(record, "submitted")}
                                type="button"
                              >
                                {record.status === "rejected" ? "Resubmit" : "Submit"}
                              </button>
                            ) : null}
                            {canMarkPaid ? (
                              <button
                                className="ghost-button"
                                disabled={isPending || !isConfigured}
                                onClick={() => handleFinancialStatusUpdate(record, "paid")}
                                type="button"
                              >
                                Mark paid
                              </button>
                            ) : null}
                            {canDeleteSubmission ? (
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  handleDelete({
                                    table: "financial_records",
                                    recordId: record.id,
                                    section: "financial_record",
                                    remove: (project) => ({
                                      ...project,
                                      financialRecords: project.financialRecords.filter((item) => item.id !== record.id)
                                    })
                                  })
                                }
                                type="button"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <p>{formatCurrency(record.amount)}</p>
                        <p className="muted-copy">{record.notes}</p>
                        <p className="muted-copy">
                          Submitted by {getRoleLabel(record.ownerRole, record.ownerEmail)}{record.ownerEmail ? ` · ${record.ownerEmail}` : ""}
                        </p>
                        <p className="muted-copy">Submitted: {formatDateTime(record.submittedAt)}</p>
                        {record.reviewedAt ? (
                          <p className="muted-copy">
                            Last client decision: {formatDateTime(record.reviewedAt)}
                            {record.reviewedByEmail ? ` · ${record.reviewedByEmail}` : ""}
                          </p>
                        ) : null}
                        {record.reviewNote ? <p className="muted-copy">Review note: {record.reviewNote}</p> : null}
                        <AttachmentList attachments={record.attachments} />
                        {canApproveSubmission ? (
                          <div className="top-gap">
                            <label className="field">
                              <span>Client decision note</span>
                              <textarea
                                onChange={(event) => setFinancialReviewNote(record.id, event.target.value)}
                                placeholder="Optional for approval. Required for rejection."
                                rows={2}
                                value={reviewDraft}
                              />
                            </label>
                            <div className="record-actions top-gap">
                              <button
                                className="primary-button"
                                disabled={isPending || !isConfigured}
                                onClick={() => handleFinancialStatusUpdate(record, "approved")}
                                type="button"
                              >
                                Approve
                              </button>
                              <button
                                className="ghost-button"
                                disabled={isPending || !isConfigured}
                                onClick={() => handleFinancialStatusUpdate(record, "rejected")}
                                type="button"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {moduleAccess.completion ? (
            <section className="content-card" id="completion">
            <div className="section-header">
              <div>
                <p className="eyebrow">Close-Out</p>
                <h3>Completion Checklist</h3>
              </div>
            </div>
            <form
              className="inline-create-form"
              onSubmit={(event) =>
                handleRecordCreate(event, {
                  table: "completion_checklist_items",
                  section: "defect",
                  buildPayload: (formData) => ({
                    item: String(formData.get("item") ?? "").trim(),
                    status: String(formData.get("status") ?? "open") as CompletionStatus,
                    details: String(formData.get("details") ?? "").trim()
                  }),
                  select: "id, item, status, details",
                  append: (project, data) => ({
                    ...project,
                    completionChecklist: [
                      {
                        id: String(data.id),
                        item: String(data.item),
                        status: data.status as CompletionStatus,
                        details: String(data.details ?? "")
                      },
                      ...project.completionChecklist
                    ]
                  })
                })
              }
            >
              <label className="field">
                <span>Checklist item</span>
                <input name="item" required />
              </label>
              <label className="field">
                <span>Status</span>
                <select name="status">
                  <option value="open">Open</option>
                  <option value="ready">Ready</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <label className="field">
                <span>Details</span>
                <input name="details" />
              </label>
              <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Add checklist item
              </button>
            </form>
            <div className="list-grid top-gap">
              {activeProject.completionChecklist.map((item) => (
                <article className="record-surface" key={item.id}>
                  <div className="record-header">
                    <strong>{item.item}</strong>
                    <div className="record-actions">
                      <span className="pill">{item.status}</span>
                      <button
                        className="ghost-button"
                        onClick={() =>
                          handleDelete({
                            table: "completion_checklist_items",
                            recordId: item.id,
                            remove: (project) => ({
                              ...project,
                              completionChecklist: project.completionChecklist.filter((entry) => entry.id !== item.id)
                            })
                          })
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="muted-copy">{item.details}</p>
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {moduleAccess.defects ? (
            <section className="content-card" id="defects">
            <div className="section-header">
              <div>
                <p className="eyebrow">Snagging</p>
                <h3>Defect Register</h3>
                <p className="muted-copy">Add defects one by one, or import a full register directly from an Excel template.</p>
              </div>
            </div>
            <div className="admin-assignment-footer top-gap">
              <p className="muted-copy">
                Template columns: `Zone`, `Defect Title`, `Status`, `Details`, plus optional embedded `Photo` images on the same row.
              </p>
              <button className="ghost-button" onClick={handleDefectTemplateDownload} type="button">
                Download Excel template
              </button>
            </div>
            <form className="module-form-grid top-gap" onSubmit={handleDefectImport}>
              <label className="field field-full">
                <span>Import defect register from Excel</span>
                <input accept=".xlsx,.xlsm" name="defectImport" type="file" />
              </label>
              <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Import defect list
              </button>
            </form>
            <form className="inline-create-form top-gap" onSubmit={handleDefectZoneCreate}>
              <label className="field">
                <span>Saved zone</span>
                <input name="zoneName" placeholder="Pantry / Front-of-house / Unit A" required />
              </label>
              <div className="field field-full">
                <span>Zone library</span>
                <div className="attachment-list">
                  {activeProject.defectZones.length ? (
                    activeProject.defectZones.map((zone) => (
                      <span className="pill" key={zone.id}>
                        {zone.name}
                      </span>
                    ))
                  ) : (
                    <span className="pill">No saved zones yet</span>
                  )}
                </div>
              </div>
              <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Save zone
              </button>
            </form>
            <div className="attachment-list top-gap">
              {activeProject.defectZones.map((zone) => (
                <button
                  className="ghost-button"
                  key={`delete-${zone.id}`}
                  onClick={() =>
                    handleDelete({
                      table: "defect_zones",
                      recordId: zone.id,
                      remove: (project) => ({
                        ...project,
                        defectZones: project.defectZones.filter((item) => item.id !== zone.id)
                      })
                    })
                  }
                  type="button"
                >
                  Remove {zone.name}
                </button>
              ))}
            </div>
            <form
              className="module-form-grid top-gap"
              onSubmit={(event) =>
                handleRecordCreate(event, {
                  table: "defects",
                  section: "defect",
                  buildPayload: async (formData) => {
                    const zone = normalizeZoneName(String(formData.get("zone") ?? ""));
                    if (zone) {
                      await ensureDefectZone(activeProject.overview.id, zone);
                    }

                    return {
                      zone,
                      title: String(formData.get("title") ?? "").trim(),
                      status: String(formData.get("status") ?? "open") as DefectStatus,
                      details: String(formData.get("details") ?? "").trim()
                    };
                  },
                  select: "id, zone, title, status, details",
                  append: (project, data, attachments) => ({
                    ...project,
                    defects: [
                      {
                        id: String(data.id),
                        zone: String(data.zone ?? ""),
                        title: String(data.title),
                        status: data.status as DefectStatus,
                        details: String(data.details ?? ""),
                        attachments
                      },
                      ...project.defects
                    ]
                  })
                })
              }
            >
              <label className="field">
                <span>Zone</span>
                <input
                  list={`defect-zones-${activeProject.overview.id || "default"}`}
                  name="zone"
                  placeholder="Select or type a zone"
                  required
                />
                <datalist id={`defect-zones-${activeProject.overview.id || "default"}`}>
                  {defectZoneNames.map((zoneName) => (
                    <option key={zoneName} value={zoneName} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Defect title</span>
                <input name="title" required />
              </label>
              <label className="field">
                <span>Status</span>
                <select name="status">
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="field field-full">
                <span>Details</span>
                <textarea name="details" rows={3} />
              </label>
              <label className="field field-full">
                <span>Photo / video attachments</span>
                <input accept="image/*,video/*" multiple name="attachments" type="file" />
              </label>
              <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                Add defect
              </button>
            </form>
            <div className="list-grid top-gap">
              {activeProject.defects.map((defect) => (
                <article className="record-surface" key={defect.id}>
                  <div className="record-header">
                    <div>
                      <strong>{defect.title}</strong>
                      <p>{defect.zone ? `${defect.zone} · ${formatSectionLabel(defect.status)}` : formatSectionLabel(defect.status)}</p>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        handleDelete({
                          table: "defects",
                          recordId: defect.id,
                          section: "defect",
                          remove: (project) => ({
                            ...project,
                            defects: project.defects.filter((item) => item.id !== defect.id)
                          })
                        })
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="muted-copy">{defect.details}</p>
                  <AttachmentList attachments={defect.attachments} />
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {viewer?.role === "master_admin" && activeProject.overview.id ? (
            <section className="content-card" id="access-control">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Access Control</p>
                  <h3>Assign project roles and module access</h3>
                </div>
              </div>
              <form className="membership-form-grid" onSubmit={handleMembershipSave}>
                <label className="field field-full">
                  <span>User email</span>
                  <input name="email" placeholder="contractor@example.com" required type="email" />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select name="role" defaultValue="contractor">
                    <option value="client">Client</option>
                    <option value="contractor">Main Contractor</option>
                    <option value="subcontractor">Sub Contractor</option>
                    <option value="consultant">Consultant</option>
                  </select>
                </label>
                <div className="permission-box field-full">
                  <span>Module access</span>
                  <div className="permission-grid">
                    {MODULE_KEYS.map((moduleKey) => (
                      <label className="permission-item" key={moduleKey}>
                        <input defaultChecked={moduleKey === "overview"} name={moduleKey} type="checkbox" />
                        <span>{formatSectionLabel(moduleKey)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                  Save access
                </button>
              </form>

              <div className="list-grid top-gap">
                {activeProject.members.length ? (
                  activeProject.members.map((member) => (
                    <article className="record-surface" key={member.id}>
                      <div className="record-header">
                        <div>
                          <strong>{member.email}</strong>
                          <p>{getRoleLabel(member.role, member.email)}</p>
                        </div>
                        <button className="ghost-button" onClick={() => handleMembershipDelete(member.id, member.userId)} type="button">
                          Remove access
                        </button>
                      </div>
                      <div className="attachment-list">
                        {MODULE_KEYS.filter((moduleKey) => member.modules[moduleKey]).map((moduleKey) => (
                          <span className="pill" key={moduleKey}>
                            {formatSectionLabel(moduleKey)}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <article className="record-surface">
                    <p className="muted-copy">No additional users assigned to this project yet.</p>
                  </article>
                )}
              </div>
            </section>
          ) : null}
        </main>
      </div> : null}
    </>
  );
}
