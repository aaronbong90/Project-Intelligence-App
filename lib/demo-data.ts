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
        contractor_submissions: true,
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
        contractor_submissions: true,
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
        contractor_submissions: true,
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
        contractor_submissions: true,
        financials: true,
        completion: true,
        defects: true
      })
    }
  ],
  projectContractors: [
    {
      id: "pc-1",
      companyName: "Northfield Projects",
      contractorType: "main_contractor",
      trades: ["architectural", "electrical_low_voltage"]
    },
    {
      id: "pc-2",
      companyName: "HydroFlow Systems",
      contractorType: "subcontractor",
      trades: ["plumbing_sanitary", "fire_protection"]
    },
    {
      id: "pc-3",
      companyName: "Voltline Engineering",
      contractorType: "subcontractor",
      trades: ["electrical"]
    }
  ],
  projectConsultants: [
    {
      id: "psc-1",
      companyName: "Studio Form Architects",
      trades: ["architect"]
    },
    {
      id: "psc-2",
      companyName: "Axis Building Services",
      trades: ["mep"]
    }
  ],
  milestones: [
    { id: "m1", title: "Site handover", dueDate: "2026-04-14" },
    { id: "m2", title: "Authority submission", dueDate: "2026-04-22" },
    { id: "m3", title: "Practical completion", dueDate: "2026-06-12" }
  ],
  contractorSubmissions: [
    {
      id: "cs1",
      submittedDate: "2026-04-13",
      items: [
        {
          id: "cs1-item-1",
          submissionType: "material_submission",
          description: "Floor tile sample board for client review.",
          quantity: 12,
          unit: "pcs"
        },
        {
          id: "cs1-item-2",
          submissionType: "material_submission",
          description: "Technical data sheet and product brochure for the selected tile range.",
          quantity: 1,
          unit: "set"
        }
      ],
      ownerUserId: "user-contractor",
      ownerEmail: "contractor@example.com",
      ownerRole: "contractor",
      clientStatus: "approved",
      clientReviewedAt: "2026-04-14T10:30:00+08:00",
      clientReviewedByUserId: "user-client",
      clientReviewedByEmail: "client@example.com",
      clientReviewNote: "Material sample and technical sheet are acceptable for the next coordination stage.",
      consultantStatus: "pending",
      consultantReviewedAt: null,
      consultantReviewedByUserId: null,
      consultantReviewedByEmail: "",
      consultantReviewNote: "",
      attachments: []
    },
    {
      id: "cs2",
      submittedDate: "2026-04-15",
      items: [
        {
          id: "cs2-item-1",
          submissionType: "rfi",
          description: "Clarification requested for ceiling bulkhead height above the service counter.",
          quantity: null,
          unit: ""
        },
        {
          id: "cs2-item-2",
          submissionType: "method_statement",
          description: "Proposed access sequence for ceiling opening and reinstatement around the counter area.",
          quantity: 1,
          unit: "statement"
        }
      ],
      ownerUserId: "user-subcontractor",
      ownerEmail: "subcontractor@example.com",
      ownerRole: "subcontractor",
      clientStatus: "pending",
      clientReviewedAt: null,
      clientReviewedByUserId: null,
      clientReviewedByEmail: "",
      clientReviewNote: "",
      consultantStatus: "rejected",
      consultantReviewedAt: "2026-04-16T16:10:00+08:00",
      consultantReviewedByUserId: "user-consultant",
      consultantReviewedByEmail: "consultant@example.com",
      consultantReviewNote: "Please attach the reflected ceiling detail and confirm the intended clear height at the service counter.",
      attachments: []
    }
  ],
  consultantSubmissions: [
    {
      id: "cts1",
      submittedDate: "2026-04-16",
      items: [
        {
          id: "cts1-item-1",
          documentType: "Architectural sketch revision",
          description: "Updated reflected ceiling sketch issued for coordination with the service counter bulkhead."
        },
        {
          id: "cts1-item-2",
          documentType: "Architectural detail",
          description: "Follow-up joinery interface detail for the ceiling bulkhead return."
        }
      ],
      ownerUserId: "user-consultant",
      ownerEmail: "consultant@example.com",
      ownerRole: "consultant",
      status: "pending",
      reviewedAt: null,
      reviewedByUserId: null,
      reviewedByEmail: "",
      reviewNote: "",
      attachments: []
    },
    {
      id: "cts2",
      submittedDate: "2026-04-12",
      items: [
        {
          id: "cts2-item-1",
          documentType: "MEP coordination note",
          description: "Consultant coordination note confirming revised route for condensate drain and low-voltage tray separation."
        }
      ],
      ownerUserId: "user-consultant",
      ownerEmail: "consultant@example.com",
      ownerRole: "consultant",
      status: "approved",
      reviewedAt: "2026-04-13T14:40:00+08:00",
      reviewedByUserId: "user-client",
      reviewedByEmail: "client@example.com",
      reviewNote: "Accepted and filed for the next site coordination meeting.",
      attachments: []
    }
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
  ],
  notifications: [
    {
      id: "notice-1",
      projectId: "demo-project",
      actorUserId: "user-consultant",
      actorEmail: "consultant@example.com",
      action: "updated",
      section: "Contractor Submission",
      title: "Consultant review marked as returned",
      details: "Please attach the reflected ceiling detail and confirm the intended clear height.",
      createdAt: "2026-04-16T16:10:00+08:00"
    },
    {
      id: "notice-2",
      projectId: "demo-project",
      actorUserId: "user-subcontractor",
      actorEmail: "subcontractor@example.com",
      action: "created",
      section: "Financials",
      title: "Variation order VO-002 submitted",
      details: "Additional power point and cable tray coordination.",
      createdAt: "2026-04-17T17:20:00+08:00"
    }
  ]
};

export const demoAdminProjects: AdminProjectSummary[] = [
  {
    id: demoProject.overview.id,
    name: demoProject.overview.name,
    ownerId: "user-master-admin",
    ownerEmail: "aaronbong90@gmail.com",
    canManageMembers: true
  }
];

export const demoAdminUsers: AdminUserRecord[] = [
  {
    id: "user-master-admin",
    email: "aaronbong90@gmail.com",
    role: "master_admin",
    isSuspended: false,
    clientOwnerId: null,
    clientOwnerEmail: null,
    createdByUserId: null,
    createdByEmail: null,
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
    clientOwnerId: "user-client",
    clientOwnerEmail: "client@example.com",
    createdByUserId: "user-master-admin",
    createdByEmail: "aaronbong90@gmail.com",
    projectAccess: [
      {
        membershipId: "pm-4",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "client",
        modules: createModulePermissions({
          overview: true,
          contractor_submissions: true,
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
    clientOwnerId: "user-client",
    clientOwnerEmail: "client@example.com",
    createdByUserId: "user-master-admin",
    createdByEmail: "aaronbong90@gmail.com",
    projectAccess: [
      {
        membershipId: "pm-1",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "contractor",
        modules: createModulePermissions({
          contractor_submissions: true,
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
    clientOwnerId: "user-client",
    clientOwnerEmail: "client@example.com",
    createdByUserId: "user-master-admin",
    createdByEmail: "aaronbong90@gmail.com",
    projectAccess: [
      {
        membershipId: "pm-3",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "subcontractor",
        modules: createModulePermissions({
          contractor_submissions: true,
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
    clientOwnerId: "user-client",
    clientOwnerEmail: "client@example.com",
    createdByUserId: "user-master-admin",
    createdByEmail: "aaronbong90@gmail.com",
    projectAccess: [
      {
        membershipId: "pm-2",
        projectId: demoProject.overview.id,
        projectName: demoProject.overview.name,
        role: "consultant",
        modules: createModulePermissions({
          overview: true,
          contractor_submissions: true,
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
    clientOwnerId: "user-client",
    clientOwnerEmail: "client@example.com",
    createdByUserId: "user-master-admin",
    createdByEmail: "aaronbong90@gmail.com",
    projectAccess: []
  }
];
