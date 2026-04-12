import type { AppUserProfile, ModuleKey, ModulePermissions, UserRole } from "@/types/app";

export const MASTER_ADMIN_EMAIL = "aaronbong90@gmail.com";
export const MODULE_KEYS: ModuleKey[] = [
  "overview",
  "handover",
  "daily_reports",
  "weekly_reports",
  "financials",
  "completion",
  "defects"
];

export function normalizeRole(value?: string | null): UserRole {
  if (value === "master_admin" || value === "client" || value === "contractor" || value === "subcontractor" || value === "consultant") {
    return value;
  }

  return "consultant";
}

export function getRoleLabel(role: UserRole, email?: string | null) {
  if (role === "master_admin" && email?.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
    return "Master Admin";
  }

  if (role === "client") return "Client";
  if (role === "contractor") return "Main Contractor";
  if (role === "subcontractor") return "Sub Contractor";
  if (role === "consultant") return "Consultant";
  return "Master Admin";
}

export function canSeeAllFinancialRecords(role: UserRole) {
  return role === "master_admin" || role === "client" || role === "consultant";
}

export function canReviewFinancialRecords(role: UserRole) {
  return role === "master_admin" || role === "client";
}

export function createFallbackProfile(email = ""): AppUserProfile {
  return {
    id: "",
    email,
    role: email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase() ? "master_admin" : "consultant",
    isSuspended: false
  };
}

export function createModulePermissions(overrides?: Partial<ModulePermissions>): ModulePermissions {
  return {
    overview: true,
    handover: false,
    daily_reports: false,
    weekly_reports: false,
    financials: false,
    completion: false,
    defects: false,
    ...overrides
  };
}

export function createFullModulePermissions(): ModulePermissions {
  return createModulePermissions({
    handover: true,
    daily_reports: true,
    weekly_reports: true,
    financials: true,
    completion: true,
    defects: true
  });
}
