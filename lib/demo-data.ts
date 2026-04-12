import { createFullModulePermissions, createModulePermissions } from "@/lib/auth";
import type { AdminProjectSummary, AdminUserRecord, ProjectBundle } from "@/types/app";

export const demoProject: ProjectBundle = {
  overview: {
    id: "demo-project",
    name: "Marina Bay Retail Fit-Out",
    location: "Singapore - Level 2 retail unit",
    clientName: "Eclipse Hospitality",
    contractorName: "Northfield Projects",
    details:
      "Pilot dashboard project for pre-handover documentation, contractor reporting, financial tracking, and close-out management.",
    handoverDate: "2026-04-14",
    completionDate: "2026-06-12"
  },
  access: {
    isOwner: true,
    canManageAccess: true,
    assignedRole: "master_admin",
    modules: createFullModulePermissions()
  },
  members: [
    {
      id: "pm-1",
      userId: "user-contractor",
      email: "contractor@example.com",
      role: "contractor",
      modules: createModulePermissions({
        financials: true,
        daily_reports: true,
        weekly_reports: true,
        completion: true,
        defects: true
      })
    },
    {
      id: "pm-3",
      userId: "user-subcontractor",
      email: "subcontractor@example.com",
      role: "subcontractor",
      modules: createModulePermissions({
        financials: true,
        daily_reports: true,
        weekly_reports: true
      })
    },
    {
      id: "pm-2",
      userId: "user-consultant",
      email: "consultant@example.com",
      role: "consultant",
      modules: createModulePermissions({
        overview: true,
        handover: true,
        financials: true,
        defects: true
      })
    },
    {
      id: "pm-4",
      userId: "user-client",
      email: "client@example.com",
      role: "client",
      modules: createModulePermissions({
        overview: true,
        financials: true,
        completion: true,
        defects: true
      })
    }
  ],
  milestones: [
    { id: "m1", title: "Site handover", dueDate: "2026-04-14" },
    { id: "m2", title: "Authority submission", dueDate: "2026-04-22" },
    { id: "m3", title: "Practical completion", dueDate: "2026-06-12" }
  ],
  surveyItems: [
    {
      id: "s1",
      area: "Front-of-house wall lining",
      item: "Existing paint and wall surface condition",
      status: "minor_issue",
      details: "Hairline cracks observed beside entrance return wall. Existing signage bracket holes visible.",
      attachments: []
    },
    {
      id: "s2",
      area: "Back-of-house drainage point",
      item: "Drain cover and floor fall condition",
      status: "good",
      details: "Drain cover intact. No ponding observed at inspection time.",
      attachments: []
    }
  ],
  dailyReports: [
    {
      id: "d1",
      reportDate: "2026-04-16",
      location: "Main site",
      workDone: "Protection works installed, floor marking completed, electrical isolation confirmed with landlord.",
      manpowerByTrade: "General workers: 3, Electrical: 2, Carpentry: 1",
      attachments: []
    }
  ],
  weeklyReports: [
    {
      id: "w1",
      weekEnding: "2026-04-18",
      summary: "Handover completed, site protection in place, first demolition permits coordinated, shop drawings underway.",
      attachments: []
    }
  ],
  financialRecords: [
    {
      id: "f1",
      documentType: "quotation",
      referenceNumber: "Q-2026-014",
      amount: 48250,
      status: "approved",
      notes: "Main fit-out quotation approved by client.",
      ownerUserId: "user-contractor",
      ownerEmail: "contractor@example.com",
      ownerRole: "contractor",
      submittedAt: "2026-04-14T09:00:00+08:00",
      reviewedAt: "2026-04-15T11:15:00+08:00",
      reviewedByUserId: "user-client",
      reviewedByEmail: "client@example.com",
      reviewNote: "Approved as submitted.",
      attachments: []
    },
    {
      id: "f2",
      documentType: "variation_order",
      referenceNumber: "VO-002",
      amount: 3850,
      status: "submitted",
      notes: "Additional power point and cable tray coordination.",
      ownerUserId: "user-subcontractor",
      ownerEmail: "subcontractor@example.com",
      ownerRole: "subcontractor",
      submittedAt: "2026-04-17T17:20:00+08:00",
      reviewedAt: null,
      reviewedByUserId: null,
      reviewedByEmail: "",
      reviewNote: "",
      attachments: []
    }
  ],
  completionChecklist: [
    {
      id: "c1",
      item: "As-built drawings submitted",
      status: "open",
      details: "Pending final mechanical markup."
    }
  ],
  defectZones: [
    { id: "dz-1", name: "Pantry" },
    { id: "dz-2", name: "Front-of-house" },
    { id: "dz-3", name: "Store room" }
  ],
  defects: [
    {
      id: "df1",
      zone: "Pantry",
      title: "Silicone joint gap at pantry backsplash",
      status: "open",
      details: "Observed during internal pre-handover inspection. Requires reseal.",
      attachments: []
    }
  ]
};

export const demoAdminProjects: AdminProjectSummary[] = [
  {
    id: demoProject.overview.id,
    name: demoProject.overview.name,
    ownerId: "user-master-admin",
    ownerEmail: "aaronbong90@gmail.com"
  }
];

export const demoAdminUsers: AdminUserRecord[] = [
  {
    id: "user-master-admin",
    email: "aaronbong90@gmail.com",
    role: "master_admin",
    isSuspended: false,
    projectAccess: [
      {
        membershipId: null,
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "master_admin",
        modules: createFullModulePermissions(),
        isOwner: true
      }
    ]
  },
  {
    id: "user-client",
    email: "client@example.com",
    role: "client",
    isSuspended: false,
    projectAccess: [
      {
        membershipId: "pm-4",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "client",
        modules: createModulePermissions({
          overview: true,
          financials: true,
          completion: true,
          defects: true
        }),
        isOwner: false
      }
    ]
  },
  {
    id: "user-contractor",
    email: "contractor@example.com",
    role: "contractor",
    isSuspended: false,
    projectAccess: [
      {
        membershipId: "pm-1",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "contractor",
        modules: createModulePermissions({
          financials: true,
          daily_reports: true,
          weekly_reports: true,
          completion: true,
          defects: true
        }),
        isOwner: false
      }
    ]
  },
  {
    id: "user-subcontractor",
    email: "subcontractor@example.com",
    role: "subcontractor",
    isSuspended: false,
    projectAccess: [
      {
        membershipId: "pm-3",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "subcontractor",
        modules: createModulePermissions({
          financials: true,
          daily_reports: true,
          weekly_reports: true
        }),
        isOwner: false
      }
    ]
  },
  {
    id: "user-consultant",
    email: "consultant@example.com",
    role: "consultant",
    isSuspended: false,
    projectAccess: [
      {
        membershipId: "pm-2",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "consultant",
        modules: createModulePermissions({
          overview: true,
          handover: true,
          financials: true,
          defects: true
        }),
        isOwner: false
      }
    ]
  },
  {
    id: "user-suspended",
    email: "suspended.consultant@example.com",
    role: "consultant",
    isSuspended: true,
    projectAccess: []
  }
];
