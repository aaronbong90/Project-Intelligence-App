export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

const APP_TIME_ZONE = "Asia/Singapore";
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type DateParts = {
  year: number;
  month: number;
  day: number;
};

function toDayNumber(parts: DateParts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function parseDateParts(value?: string | null): DateParts | null {
  if (!value) return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
      return { year, month, day };
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function getCurrentDatePartsInAppTimeZone(): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");

  return { year, month, day };
}

export function getCurrentDateSnapshot() {
  const parts = getCurrentDatePartsInAppTimeZone();
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDate(value?: string | null) {
  const parts = parseDateParts(value);
  if (!parts) return "Not set";

  return `${String(parts.day).padStart(2, "0")} ${MONTH_LABELS[parts.month - 1]} ${parts.year}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-SG", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatCountdown(targetDate?: string | null, referenceDate?: string | null) {
  const targetParts = parseDateParts(targetDate);
  if (!targetParts) return "No completion target";

  const currentParts = parseDateParts(referenceDate) ?? getCurrentDatePartsInAppTimeZone();
  const diff = toDayNumber(targetParts) - toDayNumber(currentParts);

  if (Number.isNaN(diff)) return "No completion target";
  if (diff === 0) return "Target date is today";
  if (diff > 0) return `${diff} day${diff === 1 ? "" : "s"} remaining`;
  return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} overdue`;
}

export function formatCurrency(value?: number | null) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

export function formatSectionLabel(value: string) {
  return value.replaceAll("_", " ");
}
