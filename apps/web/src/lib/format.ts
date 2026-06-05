import type { ReportStatus } from "@comment-tool/shared";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function shortId(value: string | null | undefined) {
  if (!value) {
    return "不明";
  }

  return value.slice(0, 8);
}

export function statusClass(status: ReportStatus) {
  return `status status-${status.replace("_", "-")}`;
}
