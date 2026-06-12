"use client";

import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  Check,
  ChevronDown,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type RectAnnotation,
  type ReportStatus,
  statusLabels,
  statuses
} from "@comment-tool/shared";
import { formatDate, shortId, statusClass } from "@/lib/format";
import {
  getPublicAppUrl,
  getSupabaseClient,
  isSupabaseConfigured
} from "@/lib/supabase";
import { syncWebPushSubscription } from "@/lib/webPush";

type Organization = {
  id: string;
  name: string;
};

type Project = {
  id: string;
  organization_id: string;
  name: string;
  url_pattern: string | null;
};

type Profile = {
  id: string;
  display_name: string;
  email: string | null;
};

type MemberRole = "owner" | "member";

type Member = Profile & {
  role: MemberRole;
};

type Report = {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  description: string;
  status: ReportStatus;
  page_url: string;
  page_title: string;
  screenshot_path: string;
  annotated_screenshot_path: string;
  annotations: unknown[];
  viewport_width: number;
  viewport_height: number;
  device_pixel_ratio: number;
  user_agent: string;
  attachment_paths: string[];
  assignee_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  projects?: { name: string } | null;
};

type Comment = {
  id: string;
  report_id: string;
  body: string;
  created_by: string | null;
  created_at: string;
};

type LoadState = "loading" | "ready" | "error";
type ToastTone = "default" | "error";
type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};
type SplitPaneStyle = CSSProperties & {
  "--split-left": string;
};
type ScreenshotFocusStyle = CSSProperties & {
  "--focus-aspect": string;
};

const SPLIT_MIN_PERCENT = 22;
const SPLIT_MAX_PERCENT = 45;
const MENU_EDGE_PADDING = 8;
const PROJECT_MENU_WIDTH = 168;
const PROJECT_MENU_HEIGHT = 124;
const REPORT_STATUS_MENU_WIDTH = 132;
const REPORT_STATUS_MENU_HEIGHT = 144;
const REPORT_LIST_MENU_WIDTH = 112;
const REPORT_LIST_MENU_HEIGHT = 84;
const DEFAULT_VISIBLE_STATUSES = statuses.filter((status) => status !== "archived");
const RECENT_ASSIGNEE_STORAGE_KEY = "recentAssigneeIds";
const COMMENT_LINK_PATTERN = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/gi;
const COMMENT_LINK_TRAILING_PUNCTUATION = /[.,!?;:。！？、)）]+$/;
const roleLabels: Record<MemberRole, string> = {
  owner: "管理者",
  member: "メンバー"
};

function clampMenuPosition(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getFixedMenuLeft(anchorLeft: number, menuWidth: number) {
  if (typeof window === "undefined") return anchorLeft;

  return clampMenuPosition(
    anchorLeft,
    MENU_EDGE_PADDING,
    window.innerWidth - menuWidth - MENU_EDGE_PADDING
  );
}

function readRecentAssigneeIds() {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_ASSIGNEE_STORAGE_KEY) ?? "[]");

    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeRecentAssigneeIds(assigneeIds: string[]) {
  if (typeof window === "undefined") return;

  localStorage.setItem(RECENT_ASSIGNEE_STORAGE_KEY, JSON.stringify(assigneeIds));
}

function moveAssigneeToRecentTop(currentAssigneeIds: string[], memberId: string) {
  return [memberId, ...currentAssigneeIds.filter((assigneeId) => assigneeId !== memberId)];
}

function getFixedMenuRight(anchorRight: number, menuWidth: number) {
  if (typeof window === "undefined") return 0;

  return clampMenuPosition(
    window.innerWidth - anchorRight,
    MENU_EDGE_PADDING,
    window.innerWidth - menuWidth - MENU_EDGE_PADDING
  );
}

function getFixedMenuTop(anchorRect: DOMRect, gap: number, menuHeight: number) {
  const below = anchorRect.bottom + gap;

  if (typeof window === "undefined") return below;
  if (below + menuHeight <= window.innerHeight - MENU_EDGE_PADDING) return below;

  const above = anchorRect.top - gap - menuHeight;
  if (above >= MENU_EDGE_PADDING) return above;

  return clampMenuPosition(
    below,
    MENU_EDGE_PADDING,
    window.innerHeight - menuHeight - MENU_EDGE_PADDING
  );
}

function displayProjectName(name: string | null | undefined) {
  return name === "Website feedback" ? "Webサイトフィードバック" : name;
}

function renderLinkedText(body: string, className: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(COMMENT_LINK_PATTERN)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;
    const trailingMatch = rawUrl.match(COMMENT_LINK_TRAILING_PUNCTUATION);
    const trailing = trailingMatch?.[0] ?? "";
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    const href = url.startsWith("www.") ? `https://${url}` : url;

    if (index > lastIndex) {
      parts.push(body.slice(lastIndex, index));
    }

    parts.push(
      <a
        className={className}
        href={href}
        key={`${index}-${url}`}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => event.stopPropagation()}
      >
        {url}
      </a>
    );

    if (trailing) {
      parts.push(trailing);
    }

    lastIndex = index + rawUrl.length;
  }

  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return parts.length ? parts : [body];
}

function displayReportTitle(report: Pick<Report, "description" | "page_title">) {
  return report.description || report.page_title || "コメントなし";
}

function displayUserName(
  userId: string | null | undefined,
  profilesById: Record<string, Profile>
) {
  if (!userId) {
    return "不明";
  }

  const profile = profilesById[userId];
  const displayName = profile?.display_name.trim();

  return displayName || profile?.email || shortId(userId);
}

function displayBrowserInfo(userAgent: string) {
  const edgeMatch = userAgent.match(/Edg\/([\d.]+)/);
  const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
  const firefoxMatch = userAgent.match(/Firefox\/([\d.]+)/);
  const safariMatch = userAgent.match(/Version\/([\d.]+).*Safari/);

  if (edgeMatch) {
    return `Edge ${edgeMatch[1]}`;
  }

  if (chromeMatch) {
    return `Chrome ${chromeMatch[1]}`;
  }

  if (firefoxMatch) {
    return `Firefox ${firefoxMatch[1]}`;
  }

  if (safariMatch) {
    return `Safari ${safariMatch[1]}`;
  }

  return "不明";
}

function displayDeviceInfo(report: Report) {
  const userAgent = report.user_agent;
  let platform = "不明";
  const macMatch = userAgent.match(/Mac OS X ([\d_]+)/);
  const windowsMatch = userAgent.match(/Windows NT ([\d.]+)/);
  const androidMatch = userAgent.match(/Android ([\d.]+)/);
  const iosMatch = userAgent.match(/(?:iPhone|iPad).*OS ([\d_]+)/);

  if (macMatch) {
    platform = `macOS ${macMatch[1].replaceAll("_", ".")}`;
  } else if (windowsMatch) {
    platform = `Windows ${windowsMatch[1]}`;
  } else if (androidMatch) {
    platform = `Android ${androidMatch[1]}`;
  } else if (iosMatch) {
    platform = `iOS ${iosMatch[1].replaceAll("_", ".")}`;
  }

  return `${platform} / ${report.viewport_width} x ${report.viewport_height} / DPR ${report.device_pixel_ratio}`;
}

function normalizeUrlForGrouping(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return url;
  }
}

function displayUrlForGroup(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.pathname === "/recruit" || parsed.pathname.startsWith("/recruit/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return url;
  }

  return url;
}

function isRectAnnotation(annotation: unknown): annotation is RectAnnotation {
  if (!annotation || typeof annotation !== "object") {
    return false;
  }

  const candidate = annotation as Partial<RectAnnotation>;
  return (
    candidate.type === "rect" &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    candidate.width > 0 &&
    candidate.height > 0
  );
}

function getRectAnnotations(annotations: unknown[]) {
  return annotations.filter(isRectAnnotation);
}

function getScreenshotFocusStyle(report: Report, imageUrl: string) {
  const annotations = getRectAnnotations(report.annotations);

  if (!annotations.length) {
    return null;
  }

  const devicePixelRatio = report.device_pixel_ratio > 0 ? report.device_pixel_ratio : 1;
  const bounds = annotations.reduce(
    (currentBounds, annotation) => ({
      minX: Math.min(currentBounds.minX, annotation.x),
      minY: Math.min(currentBounds.minY, annotation.y),
      maxX: Math.max(currentBounds.maxX, annotation.x + annotation.width),
      maxY: Math.max(currentBounds.maxY, annotation.y + annotation.height)
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: 0,
      maxY: 0
    }
  );
  const imageWidth = Math.max(
    Math.round(report.viewport_width * devicePixelRatio),
    Math.ceil(bounds.maxX)
  );
  const imageHeight = Math.max(
    Math.round(report.viewport_height * devicePixelRatio),
    Math.ceil(bounds.maxY)
  );

  if (!imageWidth || !imageHeight) {
    return null;
  }

  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundPosition: "center",
    backgroundSize: "contain",
    "--focus-aspect": `${imageWidth} / ${imageHeight}`
  } satisfies ScreenshotFocusStyle;
}

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const selectedReportId = searchParams.get("reportId");

  function selectReport(id: string | null, replace = false) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set("reportId", id);
    } else {
      params.delete("reportId");
    }
    const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    if (replace) {
      router.replace(url);
    } else {
      router.push(url);
    }
  }

  function selectProject(id: string) {
    if (id !== selectedProjectId && selectedReportId) {
      selectReport(null, true);
    }
    setSelectedProjectId(id);
  }

  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [ownRole, setOwnRole] = useState<MemberRole>("member");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("selectedProjectId") ?? "all";
  });
  const [reports, setReports] = useState<Report[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isInviteFormModalOpen, setIsInviteFormModalOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [openMemberMenuId, setOpenMemberMenuId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [isInviteRoleMenuOpen, setIsInviteRoleMenuOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [reportToDelete, setReportToDelete] = useState<Report | null>(null);
  const [openReportMenuId, setOpenReportMenuId] = useState<string | null>(null);
  const [reportMenuPosition, setReportMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const reportMenuRef = useRef<HTMLDivElement | null>(null);
  const [openReportStatusMenuId, setOpenReportStatusMenuId] = useState<string | null>(null);
  const [reportStatusMenuPosition, setReportStatusMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const reportStatusMenuRef = useRef<HTMLDivElement | null>(null);
  const [isProjectSelectMenuOpen, setIsProjectSelectMenuOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [projectMenuPosition, setProjectMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [visibleStatuses, setVisibleStatuses] = useState<ReportStatus[]>([
    ...DEFAULT_VISIBLE_STATUSES
  ]);
  const [isAssignedToMeOnly, setIsAssignedToMeOnly] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [reportSearchQuery, setReportSearchQuery] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [splitLeftPercent, setSplitLeftPercent] = useState(25);
  const projectSelectMenuRef = useRef<HTMLDivElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const statusFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const memberMenuRef = useRef<HTMLDivElement | null>(null);
  const inviteRoleMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const visibleReports = useMemo(() => {
    const query = reportSearchQuery.trim().toLowerCase();
    const filteredReports = reports.filter((report) => {
      const matchesProject =
        selectedProjectId === "all" || report.project_id === selectedProjectId;
      const matchesSearch = !query || displayReportTitle(report).toLowerCase().includes(query);
      const matchesStatus = visibleStatuses.includes(report.status);
      const matchesAssignee =
        !isAssignedToMeOnly || Boolean(user?.id && (report.assignee_ids ?? []).includes(user.id));

      return matchesProject && matchesSearch && matchesStatus && matchesAssignee;
    });
    const linkedReport = selectedReportId
      ? reports.find((report) => report.id === selectedReportId)
      : null;
    const reportsToDisplay =
      linkedReport && !filteredReports.some((report) => report.id === linkedReport.id)
        ? [...filteredReports, linkedReport]
        : filteredReports;

    return [...reportsToDisplay].sort((firstReport, secondReport) => {
      const createdAtComparison =
        Date.parse(secondReport.created_at) - Date.parse(firstReport.created_at);

      if (createdAtComparison !== 0) {
        return createdAtComparison;
      }

      return firstReport.id.localeCompare(secondReport.id);
    });
  }, [
    isAssignedToMeOnly,
    reportSearchQuery,
    reports,
    selectedProjectId,
    selectedReportId,
    user?.id,
    visibleStatuses
  ]);

  const reportGroups = useMemo(() => {
    const groups: Array<{ url: string; reports: Report[] }> = [];
    const reportsByUrl = new Map<string, Report[]>();

    for (const report of visibleReports) {
      const key = normalizeUrlForGrouping(report.page_url);
      const groupedReports = reportsByUrl.get(key);

      if (groupedReports) {
        groupedReports.push(report);
        continue;
      }

      const nextGroup = [report];
      reportsByUrl.set(key, nextGroup);
      groups.push({
        url: report.page_url,
        reports: nextGroup
      });
    }

    return groups;
  }, [visibleReports]);

  const selectedReport = useMemo(
    () => visibleReports.find((report) => report.id === selectedReportId) ?? null,
    [selectedReportId, visibleReports]
  );
  const accountLabel = displayName.trim() || accountEmail || user?.email || (user ? shortId(user.id) : "");
  const isOwner = ownRole === "owner";

  function showToast(messageText: string, tone: ToastTone = "default") {
    setToast({
      id: Date.now(),
      message: messageText,
      tone
    });
  }

  useEffect(() => {
    localStorage.setItem("selectedProjectId", selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (state !== "ready") {
      return;
    }

    if (
      selectedReportId &&
      !reports.some((report) => report.id === selectedReportId)
    ) {
      selectReport(null, true);
    }
  }, [reports, selectedReportId, state]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" ? 5000 : 3000
    );

    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (
      !isProjectSelectMenuOpen &&
      !isProjectMenuOpen &&
      !isStatusFilterMenuOpen &&
      !isAccountMenuOpen
    ) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;

      if (
        isProjectSelectMenuOpen &&
        projectSelectMenuRef.current &&
        !projectSelectMenuRef.current.contains(target)
      ) {
        setIsProjectSelectMenuOpen(false);
      }

      if (
        isProjectMenuOpen &&
        projectMenuRef.current &&
        !projectMenuRef.current.contains(target) &&
        !target.closest(".project-menu")
      ) {
        setIsProjectMenuOpen(false);
        setProjectMenuPosition(null);
      }

      if (
        isStatusFilterMenuOpen &&
        statusFilterMenuRef.current &&
        !statusFilterMenuRef.current.contains(target)
      ) {
        setIsStatusFilterMenuOpen(false);
      }

      if (
        isAccountMenuOpen &&
        accountMenuRef.current &&
        !accountMenuRef.current.contains(target)
      ) {
        setIsAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProjectSelectMenuOpen(false);
        setIsProjectMenuOpen(false);
        setProjectMenuPosition(null);
        setIsStatusFilterMenuOpen(false);
        setIsAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen, isProjectMenuOpen, isProjectSelectMenuOpen, isStatusFilterMenuOpen]);

  useEffect(() => {
    if (!openReportMenuId && !openReportStatusMenuId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (
        openReportMenuId &&
        !target?.closest(".report-list-menu-wrap") &&
        !reportMenuRef.current?.contains(target)
      ) {
        setOpenReportMenuId(null);
        setReportMenuPosition(null);
      }

      if (
        openReportStatusMenuId &&
        !target?.closest(".report-list-status-menu-wrap") &&
        !reportStatusMenuRef.current?.contains(target)
      ) {
        setOpenReportStatusMenuId(null);
        setReportStatusMenuPosition(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenReportMenuId(null);
        setReportMenuPosition(null);
        setOpenReportStatusMenuId(null);
        setReportStatusMenuPosition(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openReportMenuId, openReportStatusMenuId]);

  useEffect(() => {
    if (!openMemberMenuId) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;

      if (!memberMenuRef.current?.contains(target)) {
        setOpenMemberMenuId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMemberMenuId(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMemberMenuId]);

  useEffect(() => {
    if (!isInviteRoleMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;

      if (!inviteRoleMenuRef.current?.contains(target)) {
        setIsInviteRoleMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsInviteRoleMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInviteRoleMenuOpen]);

  function updateSplitFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const container = event.currentTarget.parentElement;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
    setSplitLeftPercent(
      Math.min(SPLIT_MAX_PERCENT, Math.max(SPLIT_MIN_PERCENT, nextPercent))
    );
  }

  function handleSplitPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSplitFromPointer(event);
  }

  function handleSplitPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      updateSplitFromPointer(event);
    }
  }

  function handleSplitPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleSplitKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSplitLeftPercent((current) => Math.max(SPLIT_MIN_PERCENT, current - 3));
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitLeftPercent((current) => Math.min(SPLIT_MAX_PERCENT, current + 3));
    }

    if (event.key === "Home") {
      event.preventDefault();
      setSplitLeftPercent(SPLIT_MIN_PERCENT);
    }

    if (event.key === "End") {
      event.preventDefault();
      setSplitLeftPercent(SPLIT_MAX_PERCENT);
    }
  }

  function mergeProfiles(nextProfiles: Profile[]) {
    if (!nextProfiles.length) {
      return;
    }

    setProfilesById((current) => {
      const next = { ...current };

      for (const profile of nextProfiles) {
        next[profile.id] = profile;
      }

      return next;
    });
  }

  async function loadProfilesForUsers(userIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(userIds.filter(Boolean))) as string[];

    if (!ids.length) {
      return;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", ids);

    if (error) {
      showToast("名前の読み込みにはSupabaseで最新SQLの実行が必要です。", "error");
      return;
    }

    mergeProfiles((data ?? []) as Profile[]);
  }

  async function loadMembers(organizationId = organization?.id) {
    if (!organizationId) {
      return;
    }

    const supabase = getSupabaseClient();
    const { data: membershipsData, error: membershipsError } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId);

    if (membershipsError) {
      showToast(membershipsError.message, "error");
      return;
    }

    const memberIds = (membershipsData ?? [])
      .map((membership) => membership.user_id)
      .filter(Boolean);

    if (!memberIds.length) {
      setMembers([]);
      return;
    }

    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", memberIds);

    if (profilesError) {
      showToast(profilesError.message, "error");
      return;
    }

    const profiles = (profilesData ?? []) as Profile[];
    mergeProfiles(profiles);
    setMembers(
      memberIds.map((memberId) => {
        const profile = profiles.find((nextProfile) => nextProfile.id === memberId);
        const membership = membershipsData?.find(
          (nextMembership) => nextMembership.user_id === memberId
        );
        const role = membership?.role === "owner" ? "owner" : "member";

        return (
          {
            ...(profile ?? {
              id: memberId,
              display_name: "",
              email: null
            }),
            role
          }
        );
      })
    );
  }

  async function loadOwnProfile(currentUser: User) {
    const supabase = getSupabaseClient();
    const fallbackName =
      typeof currentUser.user_metadata.display_name === "string"
        ? currentUser.user_metadata.display_name
        : "";
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      setDisplayName(fallbackName);
      showToast("名前を保存するにはSupabaseで最新SQLを実行してください。", "error");
      return;
    }

    if (data) {
      const profile = data as Profile;
      setDisplayName(profile.display_name);
      mergeProfiles([profile]);
      return;
    }

    const { data: insertedProfile, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: currentUser.id,
        display_name: fallbackName,
        email: currentUser.email ?? null
      })
      .select("id, display_name, email")
      .single();

    if (insertError) {
      setDisplayName(fallbackName);
      showToast("名前を保存するにはSupabaseで最新SQLを実行してください。", "error");
      return;
    }

    const profile = insertedProfile as Profile;
    setDisplayName(profile.display_name);
    mergeProfiles([profile]);
  }

  async function loadDashboard() {
    if (!isSupabaseConfigured()) {
      setState("error");
      setMessage("Supabase設定が見つかりません。");
      return;
    }

    setState("loading");
    setMessage("");

    const supabase = getSupabaseClient();
    const {
      data: { session: currentSession }
    } = await supabase.auth.getSession();

    if (!currentSession) {
      router.replace("/login");
      return;
    }

    setUser(currentSession.user);
    setAccountEmail(currentSession.user.email ?? "");
    void syncWebPushSubscription(currentSession.access_token).catch(() => undefined);
    await loadOwnProfile(currentSession.user);

    let { data: memberships, error: membershipsError } = await supabase
      .from("memberships")
      .select("organization_id, role")
      .limit(1);

    if (membershipsError) {
      setState("error");
      setMessage(membershipsError.message);
      return;
    }

    if (!memberships?.length) {
      const workspaceName = `${currentSession.user.email ?? "ユーザー"} のワークスペース`;
      const { error: workspaceError } = await supabase.rpc("create_workspace", {
        workspace_name: workspaceName,
        project_name: "Webサイトフィードバック"
      });

      if (workspaceError) {
        setState("error");
        setMessage(workspaceError.message);
        return;
      }

      const retry = await supabase
        .from("memberships")
        .select("organization_id, role")
        .limit(1);
      memberships = retry.data;
      membershipsError = retry.error;

      if (membershipsError) {
        setState("error");
        setMessage(membershipsError.message);
        return;
      }
    }

    const organizationId = memberships?.[0]?.organization_id;
    const membershipRole: MemberRole = memberships?.[0]?.role === "owner" ? "owner" : "member";

    if (!organizationId) {
      setState("error");
      setMessage("ワークスペースを作成できませんでした。");
      return;
    }

    const [{ data: organizationData, error: orgError }, projectsResult] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("id, name")
          .eq("id", organizationId)
          .single(),
        supabase
          .from("projects")
          .select("id, organization_id, name, url_pattern")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: true })
      ]);

    if (orgError || projectsResult.error) {
      setState("error");
      setMessage(orgError?.message ?? projectsResult.error?.message ?? "");
      return;
    }

    setOrganization(organizationData as Organization);
    setOwnRole(membershipRole);
    const nextProjects = (projectsResult.data ?? []) as Project[];
    setProjects(nextProjects);
    setSelectedProjectId((current) =>
      current === "all" || nextProjects.some((p) => p.id === current) ? current : "all"
    );
    await loadMembers(organizationId);
    await loadReports(organizationId);
    setState("ready");
  }

  async function loadReports(organizationId = organization?.id) {
    if (!organizationId) {
      return;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("reports")
      .select("*, projects(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      showToast(error.message, "error");
      return;
    }

    const nextReports = (data ?? []) as unknown as Report[];
    setReports(nextReports);
    await loadProfilesForUsers(
      nextReports.flatMap((report) => [
        report.created_by,
        ...(report.assignee_ids ?? [])
      ])
    );
    const currentId = searchParams.get("reportId");
    const currentReport = currentId
      ? nextReports.find((report) => report.id === currentId)
      : null;
    const nextId =
      currentReport
        ? currentId
        : (nextReports.find((report) => visibleStatuses.includes(report.status))?.id ?? null);
    if (nextId !== currentId) {
      selectReport(nextId, true);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleLogout() {
    await getSupabaseClient().auth.signOut();
    router.replace("/login");
  }

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || !isOwner) {
      return;
    }

    const supabase = getSupabaseClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      showToast("認証が必要です。", "error");
      return;
    }

    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: inviteEmail,
          displayName: inviteDisplayName,
          password: invitePassword,
          role: inviteRole
        })
      });
      const result = (await response.json().catch(() => null)) as { token?: string; error?: string } | null;

      if (!response.ok || !result?.token) {
        showToast(result?.error ?? "招待リンクを作成できませんでした。", "error");
        return;
      }

      const url = `${getPublicAppUrl().replace(/\/$/, "")}/invite/${result.token}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      setInviteEmail("");
      setInviteDisplayName("");
      setInvitePassword("");
      setInviteRole("member");
      setIsInviteFormModalOpen(false);
      showToast("招待リンクを発行しました。");
    } catch {
      showToast("招待リンクを発行できませんでした。", "error");
    }
  }

  async function handleChangeMemberRole(memberId: string, nextRole: MemberRole) {
    if (!organization || !isOwner) {
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("memberships")
      .update({ role: nextRole })
      .eq("organization_id", organization.id)
      .eq("user_id", memberId);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    setMembers((currentMembers) =>
      currentMembers.map((member) =>
        member.id === memberId ? { ...member, role: nextRole } : member
      )
    );
    if (memberId === user?.id) {
      setOwnRole(nextRole);
    }
    showToast("権限を変更しました。");
  }

  async function handleDeleteMember(memberId: string) {
    if (!organization || !isOwner) {
      return;
    }

    const supabase = getSupabaseClient();
    const reportsWithMember = reports.filter((report) =>
      (report.assignee_ids ?? []).includes(memberId)
    );

    for (const report of reportsWithMember) {
      const { error: reportError } = await supabase
        .from("reports")
        .update({
          assignee_ids: (report.assignee_ids ?? []).filter((assigneeId) => assigneeId !== memberId)
        })
        .eq("id", report.id)
        .eq("organization_id", organization.id);

      if (reportError) {
        showToast(reportError.message, "error");
        return;
      }
    }

    const { error } = await supabase
      .from("memberships")
      .delete()
      .eq("organization_id", organization.id)
      .eq("user_id", memberId);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    setMembers((currentMembers) => currentMembers.filter((member) => member.id !== memberId));
    setReports((currentReports) =>
      currentReports.map((report) => ({
        ...report,
        assignee_ids: (report.assignee_ids ?? []).filter((assigneeId) => assigneeId !== memberId)
      }))
    );
  }

  async function handleCopyReportLink(report: Report) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("reportId", report.id);
    const url = `${getPublicAppUrl().replace(/\/$/, "")}${pathname}?${params.toString()}`;

    setOpenReportMenuId(null);
    setReportMenuPosition(null);

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(url);
      showToast("リンクをコピーしました。");
    } catch {
      showToast("リンクをコピーできませんでした。", "error");
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || !user || !isOwner || !newProjectName.trim()) {
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from("projects").insert({
      organization_id: organization.id,
      name: newProjectName.trim(),
      created_by: user.id
    });

    if (error) {
      showToast(error.message, "error");
      return;
    }

    setNewProjectName("");
    setIsProjectModalOpen(false);
    showToast("プロジェクトを作成しました。");
    await loadDashboard();
  }

  async function handleSaveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const nextDisplayName = displayName.trim();
    const nextEmail = accountEmail.trim();
    const supabase = getSupabaseClient();

    if (nextEmail && nextEmail !== user.email) {
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({
        email: nextEmail
      });

      if (updateError) {
        showToast(updateError.message, "error");
        return;
      }

      if (updateData.user) {
        setUser(updateData.user);
      }
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          display_name: nextDisplayName,
          email: nextEmail || (user.email ?? null)
        },
        { onConflict: "id" }
      )
      .select("id, display_name, email")
      .single();

    if (error) {
      showToast(error.message, "error");
      return;
    }

    const profile = data as Profile;
    setDisplayName(profile.display_name);
    setAccountEmail(profile.email ?? nextEmail);
    mergeProfiles([profile]);
    showToast(
      nextEmail && nextEmail !== user.email
        ? "保存しました。メールアドレス変更の確認メールが届く場合があります。"
        : "保存しました。"
    );
  }

  async function handleDeleteReport() {
    if (!reportToDelete || !isOwner) {
      return;
    }

    const supabase = getSupabaseClient();
    const targetReport = reportToDelete;
    const assetPaths = [
      targetReport.screenshot_path,
      targetReport.annotated_screenshot_path
    ].filter(Boolean);

    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("id", targetReport.id)
      .eq("organization_id", targetReport.organization_id);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    if (assetPaths.length) {
      await supabase.storage.from("report-assets").remove(assetPaths);
    }

    setReportToDelete(null);
    setReports((currentReports) =>
      currentReports.filter((report) => report.id !== targetReport.id)
    );
    if (selectedReportId === targetReport.id) {
      selectReport(null, true);
    }
    await loadReports(targetReport.organization_id);
  }

  async function handleListStatusChange(report: Report, nextStatus: ReportStatus) {
    if (report.status === nextStatus) {
      setOpenReportStatusMenuId(null);
      setReportStatusMenuPosition(null);
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("reports")
      .update({ status: nextStatus })
      .eq("id", report.id)
      .eq("organization_id", report.organization_id);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    setReports((currentReports) =>
      currentReports.map((currentReport) =>
        currentReport.id === report.id
          ? { ...currentReport, status: nextStatus }
          : currentReport
      )
    );
    setOpenReportStatusMenuId(null);
    setReportStatusMenuPosition(null);

  }

  async function handleDeleteProject() {
    if (!projectToDelete || !organization || !isOwner || projectDeleteConfirmation !== "削除") {
      return;
    }

    const supabase = getSupabaseClient();
    const targetProject = projectToDelete;

    const { data: projectReports, error: reportsError } = await supabase
      .from("reports")
      .select("id, screenshot_path, annotated_screenshot_path")
      .eq("organization_id", organization.id)
      .eq("project_id", targetProject.id);

    if (reportsError) {
      showToast(reportsError.message, "error");
      return;
    }

    const assetPaths = (projectReports ?? [])
      .flatMap((report) => [
        report.screenshot_path,
        report.annotated_screenshot_path
      ])
      .filter(Boolean);

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", targetProject.id)
      .eq("organization_id", organization.id);

    if (error) {
      showToast(error.message, "error");
      return;
    }

    if (assetPaths.length) {
      await supabase.storage.from("report-assets").remove(assetPaths);
    }

    setProjectToDelete(null);
    setProjectDeleteConfirmation("");
    setSelectedProjectId("all");
    selectReport(null, true);
    await loadDashboard();
  }

  function getAssetUrl(path: string) {
    const { data } = getSupabaseClient()
      .storage
      .from("report-assets")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  if (state === "loading") {
    return (
      <main aria-label="読み込み中" className="loading-shell">
        <span aria-hidden="true" className="loading-spinner" />
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">設定</p>
          <h1>管理画面を表示できません</h1>
          <p className="subtitle">{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {toast ? (
        <div className="toast-viewport" role="status" aria-live="polite">
          <div className={toast.tone === "error" ? "toast toast-error" : "toast"}>
            {toast.message}
          </div>
        </div>
      ) : null}
      <div className="page">
        <section
          className={`mail-split${selectedReportId ? " mobile-detail-view" : ""}`}
          style={{ "--split-left": `${splitLeftPercent}%` } as SplitPaneStyle}
        >
          <div className="mail-list-pane">
            <div className="report-list-panel">
              <div className="panel-nav">
                <div className="brand">
                  <span className="brand-mark" aria-hidden="true">
                    <img alt="" src="/icon.svg" />
                  </span>
                  <span>23 comments</span>
                </div>
                <div className="project-switcher">
                  <div className="project-select-menu-wrap" ref={projectSelectMenuRef}>
                    <button
                      aria-expanded={isProjectSelectMenuOpen}
                      aria-haspopup="menu"
                      aria-label="プロジェクト"
                      className="project-select-button"
                      type="button"
                      onClick={() => {
                        setIsProjectMenuOpen(false);
                        setIsProjectSelectMenuOpen((isOpen) => !isOpen);
                      }}
                    >
                      {selectedProject ? displayProjectName(selectedProject.name) : "すべてのプロジェクト"}
                    </button>
                    {isProjectSelectMenuOpen ? (
                      <div className="project-select-menu" role="menu">
                        {[
                          { id: "all", name: "すべてのプロジェクト" },
                          ...projects.map((project) => ({
                            id: project.id,
                            name: displayProjectName(project.name) ?? ""
                          }))
                        ].map((project) => (
                          <button
                            className={
                              selectedProjectId === project.id
                                ? "project-menu-item project-menu-item-active"
                                : "project-menu-item"
                            }
                            key={project.id}
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              selectProject(project.id);
                              setIsProjectSelectMenuOpen(false);
                            }}
                          >
                            {project.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {isOwner ? (
                    <div className="project-menu-wrap" ref={projectMenuRef}>
                      <button
                        aria-expanded={isProjectMenuOpen}
                        aria-haspopup="menu"
                        aria-label="プロジェクト設定"
                        className="project-menu-button"
                        type="button"
                        onClick={(event) => {
                          setIsProjectSelectMenuOpen(false);
                          const rect = event.currentTarget.getBoundingClientRect();
                          setIsProjectMenuOpen((isOpen) => {
                            if (isOpen) {
                              setProjectMenuPosition(null);
                              return false;
                            }

                            setProjectMenuPosition({
                              top: getFixedMenuTop(rect, 8, PROJECT_MENU_HEIGHT),
                              left: getFixedMenuLeft(rect.left, PROJECT_MENU_WIDTH)
                            });
                            return true;
                          });
                        }}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {isProjectMenuOpen && projectMenuPosition ? createPortal(
                        <div
                          className="project-menu"
                          role="menu"
                          style={{
                            position: "fixed",
                            top: projectMenuPosition.top,
                            left: projectMenuPosition.left
                          }}
                        >
                          <button
                            className="project-menu-item"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setIsProjectMenuOpen(false);
                              setProjectMenuPosition(null);
                              setIsProjectModalOpen(true);
                            }}
                          >
                            プロジェクト作成
                          </button>
                          <button
                            className="project-menu-item project-menu-item-danger"
                            disabled={!selectedProject}
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              if (!selectedProject) {
                                return;
                              }

                              setIsProjectMenuOpen(false);
                              setProjectMenuPosition(null);
                              setProjectToDelete(selectedProject);
                            }}
                          >
                            プロジェクト削除
                          </button>
                          <button
                            className="project-menu-item"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setIsProjectMenuOpen(false);
                              setProjectMenuPosition(null);
                              void loadMembers();
                              setIsInviteModalOpen(true);
                            }}
                          >
                            共有
                          </button>
                        </div>,
                        document.body
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="report-list-controls">
                <div className="report-search-row">
                  <input
                    aria-label="内容を検索"
                    className="report-search-input"
                    placeholder="検索"
                    value={reportSearchQuery}
                    onChange={(event) => setReportSearchQuery(event.target.value)}
                  />
                  <div className="report-filter-menu-wrap" ref={statusFilterMenuRef}>
                    <button
                      aria-expanded={isStatusFilterMenuOpen}
                      aria-haspopup="menu"
                      aria-label="ステータスフィルター"
                      className={
                        visibleStatuses.length < statuses.length || isAssignedToMeOnly
                          ? "report-filter-button report-filter-button-active"
                          : "report-filter-button"
                      }
                      type="button"
                      onClick={() => setIsStatusFilterMenuOpen((open) => !open)}
                    >
                      <ListFilter size={16} />
                    </button>
                    {isStatusFilterMenuOpen ? (
                      <div className="report-filter-menu" role="menu">
                        {statuses.map((s) => (
                          <button
                            aria-checked={visibleStatuses.includes(s)}
                            className="report-filter-menu-item"
                            key={s}
                            role="menuitemcheckbox"
                            type="button"
                            onClick={() => {
                              setVisibleStatuses((prev) =>
                                prev.includes(s)
                                  ? prev.length > 1
                                    ? prev.filter((x) => x !== s)
                                    : prev
                                  : [...prev, s]
                              );
                            }}
                          >
                            <span className={`status-dot ${statusClass(s)}`} />
                            {statusLabels[s]}
                            {visibleStatuses.includes(s) ? <Check size={14} /> : null}
                          </button>
                        ))}
                        <button
                          aria-checked={isAssignedToMeOnly}
                          className="report-filter-menu-item report-filter-menu-item-separated"
                          role="menuitemcheckbox"
                          type="button"
                          onClick={() => setIsAssignedToMeOnly((isOnly) => !isOnly)}
                        >
                          自分が担当
                          {isAssignedToMeOnly ? <Check size={14} /> : null}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="report-list">
                {reportGroups.map((group) => (
                  <section aria-label={group.url} className="report-list-group" key={group.url}>
                    <a
                      className="report-list-url"
                      href={group.url}
                      rel="noreferrer"
                      target="_blank"
                      title={group.url}
                    >
                      {displayUrlForGroup(group.url)}
                    </a>
                    <div className="report-list-group-items" role="list">
                      {group.reports.map((report) => (
                        <div
                          className={
                            report.id === selectedReportId
                              ? "report-list-item report-list-item-selected"
                              : "report-list-item"
                          }
                          key={report.id}
                          role="listitem"
                        >
                          <div className="report-list-item-content">
                            <div
                              className={`report-list-status-menu-wrap${openReportStatusMenuId === report.id ? " report-list-status-menu-open" : ""}`}
                            >
                              <button
                                aria-expanded={openReportStatusMenuId === report.id}
                                aria-haspopup="menu"
                                className={`status-button report-list-status-button ${statusClass(report.status)}`}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (openReportStatusMenuId === report.id) {
                                    setOpenReportStatusMenuId(null);
                                    setReportStatusMenuPosition(null);
                                  } else {
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setOpenReportMenuId(null);
                                    setReportMenuPosition(null);
                                    setReportStatusMenuPosition({
                                      top: getFixedMenuTop(rect, 4, REPORT_STATUS_MENU_HEIGHT),
                                      left: getFixedMenuLeft(rect.left, REPORT_STATUS_MENU_WIDTH)
                                    });
                                    setOpenReportStatusMenuId(report.id);
                                  }
                                }}
                              >
                                {statusLabels[report.status]}
                              </button>
                              {openReportStatusMenuId === report.id && reportStatusMenuPosition
                                ? createPortal(
                                    <div
                                      ref={reportStatusMenuRef}
                                      className="status-menu report-list-status-menu"
                                      role="menu"
                                      style={{
                                        position: "fixed",
                                        top: reportStatusMenuPosition.top,
                                        left: reportStatusMenuPosition.left
                                      }}
                                    >
                                      {statuses.map((nextStatus) => (
                                        <button
                                          aria-current={nextStatus === report.status ? "true" : undefined}
                                          className="status-menu-item"
                                          key={nextStatus}
                                          role="menuitem"
                                          type="button"
                                          onClick={() => handleListStatusChange(report, nextStatus)}
                                        >
                                          <span className={statusClass(nextStatus)}>
                                            {statusLabels[nextStatus]}
                                          </span>
                                        </button>
                                      ))}
                                    </div>,
                                    document.body
                                  )
                                : null}
                            </div>
                            <button
                              className="report-list-item-select"
                              type="button"
                              onClick={() => selectReport(report.id)}
                            >
                              <span className="report-list-title">{displayReportTitle(report)}</span>
                            </button>
                          </div>
                          <div className={`report-list-menu-wrap${openReportMenuId === report.id ? " report-list-menu-open" : ""}`}>
                            <button
                              aria-label="メニュー"
                              className="report-list-menu-button"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openReportMenuId === report.id) {
                                  setOpenReportMenuId(null);
                                  setReportMenuPosition(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setReportMenuPosition({
                                    top: getFixedMenuTop(rect, 4, REPORT_LIST_MENU_HEIGHT),
                                    right: getFixedMenuRight(rect.right, REPORT_LIST_MENU_WIDTH)
                                  });
                                  setOpenReportMenuId(report.id);
                                }
                              }}
                            >
                              <MoreHorizontal size={14} />
                            </button>
                            {openReportMenuId === report.id && reportMenuPosition
                              ? createPortal(
                                  <div
                                    ref={reportMenuRef}
                                    className="report-list-menu"
                                    role="menu"
                                    style={{ position: "fixed", top: reportMenuPosition.top, right: reportMenuPosition.right }}
                                  >
                                    <button
                                      className="report-list-menu-item"
                                      role="menuitem"
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleCopyReportLink(report);
                                      }}
                                    >
                                      リンクをコピー
                                    </button>
                                    {isOwner ? (
                                      <button
                                        className="report-list-menu-item report-list-menu-item-danger"
                                        role="menuitem"
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenReportMenuId(null);
                                          setReportMenuPosition(null);
                                          setReportToDelete(report);
                                        }}
                                      >
                                        削除
                                      </button>
                                    ) : null}
                                  </div>,
                                  document.body
                                )
                              : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {!visibleReports.length ? (
                  <div className="detail-empty">
                    まだ投稿はありません。Chrome拡張からページをキャプチャしてください。
                  </div>
                ) : null}
              </div>
              <div className="panel-account">
                <div className="account-menu-wrap" ref={accountMenuRef}>
                  <div className="account-menu-button">
                    <span className="account-identity">
                      <span className="account-name">{accountLabel}</span>
                      <span className="account-role">{roleLabels[ownRole]}</span>
                    </span>
                    <button
                      aria-expanded={isAccountMenuOpen}
                      aria-haspopup="menu"
                      className="account-menu-trigger"
                      type="button"
                      onClick={() => {
                        setIsAccountMenuOpen((isOpen) => !isOpen);
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  {isAccountMenuOpen ? (
                    <div className="account-menu" role="menu">
                      <button
                        className="account-menu-item"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          setIsAccountModalOpen(true);
                        }}
                      >
                        編集
                      </button>
                      <button
                        className="account-menu-item account-menu-item-danger"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          void handleLogout();
                        }}
                      >
                        ログアウト
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div
            aria-label="一覧と詳細の幅を調整"
            aria-orientation="vertical"
            aria-valuemax={SPLIT_MAX_PERCENT}
            aria-valuemin={SPLIT_MIN_PERCENT}
            aria-valuenow={Math.round(splitLeftPercent)}
            className="split-resizer"
            role="separator"
            tabIndex={0}
            onKeyDown={handleSplitKeyDown}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerUp}
          />

          <div className="mail-detail-pane">
            <button
              className="mobile-back-button"
              type="button"
              onClick={() => selectReport(null)}
            >
              ← 戻る
            </button>
            <ReportDetail
              getAssetUrl={getAssetUrl}
              getUserName={(userId) => displayUserName(userId, profilesById)}
              loadProfilesForUsers={loadProfilesForUsers}
              members={members}
              canManage={isOwner}
              currentUserId={user?.id ?? null}
              onChanged={() => loadReports()}
              onNotify={showToast}
              report={selectedReport}
            />
          </div>
        </section>
      </div>

      {isInviteModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsInviteModalOpen(false);
            setIsInviteFormModalOpen(false);
          }}
        >
          <section
            aria-labelledby="invite-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="invite-dialog-title">共有</h2>
              </div>
              <div className="modal-header-actions">
                <button
                  className="button modal-header-button"
                  type="button"
                  onClick={() => setIsInviteFormModalOpen(true)}
                >
                  招待
                </button>
                <button
                  aria-label="閉じる"
                  className="modal-close"
                  type="button"
                  onClick={() => {
                    setIsInviteModalOpen(false);
                    setIsInviteFormModalOpen(false);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="modal-body">
              <section className="member-section" aria-label="メンバー">
                <h3>メンバー</h3>
                {members.length ? (
                  <ul className="member-list">
                    {members.map((member) => {
                      const memberName =
                        member.display_name.trim() || member.email || shortId(member.id);

                      return (
                        <li className="member-item" key={member.id}>
                          <div className="member-info">
                            <span className="member-name">{memberName}</span>
                            <span className="member-email">
                              {member.email || "メールアドレス未登録"}
                            </span>
                          </div>
                          <div
                            className="member-actions"
                            ref={openMemberMenuId === member.id ? memberMenuRef : null}
                          >
                            <button
                              aria-expanded={openMemberMenuId === member.id}
                              aria-haspopup="menu"
                              className="member-role-button"
                              type="button"
                              onClick={() =>
                                setOpenMemberMenuId((currentId) =>
                                  currentId === member.id ? null : member.id
                                )
                              }
                            >
                              <span>{roleLabels[member.role]}</span>
                              <ChevronDown size={16} />
                            </button>
                            {openMemberMenuId === member.id ? (
                              <div className="member-role-menu" role="menu">
                                <button
                                  className={
                                    member.role === "owner"
                                      ? "member-role-menu-item member-role-menu-item-selected"
                                      : "member-role-menu-item"
                                  }
                                  role="menuitem"
                                  type="button"
                                  onClick={() => {
                                    setOpenMemberMenuId(null);
                                    void handleChangeMemberRole(member.id, "owner");
                                  }}
                                >
                                  管理者
                                </button>
                                <button
                                  className={
                                    member.role === "member"
                                      ? "member-role-menu-item member-role-menu-item-selected"
                                      : "member-role-menu-item"
                                  }
                                  role="menuitem"
                                  type="button"
                                  onClick={() => {
                                    setOpenMemberMenuId(null);
                                    void handleChangeMemberRole(member.id, "member");
                                  }}
                                >
                                  メンバー
                                </button>
                                <button
                                  className="member-role-menu-item member-role-menu-item-danger"
                                  role="menuitem"
                                  type="button"
                                  onClick={() => {
                                    setOpenMemberMenuId(null);
                                    void handleDeleteMember(member.id);
                                  }}
                                >
                                  削除
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="member-empty">メンバーはいません。</p>
                )}
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {isInviteFormModalOpen ? (
        <div
          className="modal-backdrop modal-backdrop-stacked"
          onClick={() => setIsInviteFormModalOpen(false)}
        >
          <section
            aria-labelledby="invite-form-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="invite-form-dialog-title">招待</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setIsInviteFormModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleCreateInvite}>
              <div className="form-row">
                <label htmlFor="invite-email">メールアドレス</label>
                <input
                  className="input"
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="invite-display-name">ID</label>
                <input
                  className="input"
                  id="invite-display-name"
                  value={inviteDisplayName}
                  onChange={(event) => setInviteDisplayName(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="invite-password">パスワード</label>
                <input
                  className="input"
                  id="invite-password"
                  minLength={6}
                  type="password"
                  value={invitePassword}
                  onChange={(event) => setInvitePassword(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label id="invite-role-label">権限</label>
                <div className="invite-role-menu-wrap" ref={inviteRoleMenuRef}>
                  <button
                    aria-expanded={isInviteRoleMenuOpen}
                    aria-haspopup="menu"
                    aria-labelledby="invite-role-label"
                    className="member-role-button invite-role-button"
                    type="button"
                    onClick={() => setIsInviteRoleMenuOpen((isOpen) => !isOpen)}
                  >
                    <span>{roleLabels[inviteRole]}</span>
                    <ChevronDown size={18} />
                  </button>
                  {isInviteRoleMenuOpen ? (
                    <div className="member-role-menu invite-role-menu" role="menu">
                      <button
                        className={
                          inviteRole === "member"
                            ? "member-role-menu-item member-role-menu-item-selected"
                            : "member-role-menu-item"
                        }
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setInviteRole("member");
                          setIsInviteRoleMenuOpen(false);
                        }}
                      >
                        メンバー
                      </button>
                      <button
                        className={
                          inviteRole === "owner"
                            ? "member-role-menu-item member-role-menu-item-selected"
                            : "member-role-menu-item"
                        }
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setInviteRole("owner");
                          setIsInviteRoleMenuOpen(false);
                        }}
                      >
                        管理者
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="modal-actions">
                <button className="button button-primary" type="submit">
                  招待リンクを発行
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {reportToDelete ? (
        <div className="modal-backdrop" onClick={() => setReportToDelete(null)}>
          <section
            aria-labelledby="delete-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="delete-dialog-title">コメントを削除</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setReportToDelete(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-copy">
                このコメントを削除します。詳細画面のコメントスレッドも一緒に削除されます。
              </p>
              <div className="delete-preview">
                {reportToDelete.description ||
                  reportToDelete.page_title ||
                  "コメントなし"}
              </div>
              <div className="modal-actions">
                <button className="button button-danger" type="button" onClick={handleDeleteReport}>
                  <Trash2 size={16} />
                  削除
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isProjectModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsProjectModalOpen(false)}>
          <section
            aria-labelledby="project-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">プロジェクト</p>
                <h2 id="project-dialog-title">プロジェクト作成</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setIsProjectModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleCreateProject}>
              <div className="form-row">
                <label htmlFor="project-name">プロジェクト名</label>
                <input
                  className="input"
                  id="project-name"
                  placeholder="新しいプロジェクト"
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="button button-primary" type="submit">
                  <Plus size={16} />
                  作成
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {projectToDelete ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setProjectToDelete(null);
            setProjectDeleteConfirmation("");
          }}
        >
          <section
            aria-labelledby="project-delete-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="project-delete-dialog-title">プロジェクトを削除</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => {
                  setProjectToDelete(null);
                  setProjectDeleteConfirmation("");
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-copy">
                このプロジェクトと、紐づくコメントをすべて削除します。続けるには、以下に「削除」と入力してください。
              </p>
              <div className="delete-preview">
                {displayProjectName(projectToDelete.name)}
                <br />
                {reports.filter((report) => report.project_id === projectToDelete.id).length}
                件のコメント
              </div>
              <input
                aria-label="削除確認"
                className="input"
                placeholder="削除"
                value={projectDeleteConfirmation}
                onChange={(event) => setProjectDeleteConfirmation(event.target.value)}
              />
              <div className="modal-actions">
                <button
                  className="button button-danger"
                  disabled={projectDeleteConfirmation !== "削除"}
                  type="button"
                  onClick={handleDeleteProject}
                >
                  <Trash2 size={16} />
                  削除
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isAccountModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsAccountModalOpen(false)}>
          <section
            aria-labelledby="account-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="account-dialog-title">アカウント設定</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleSaveAccount}>
              <div className="form-row">
                <label htmlFor="account-display-name">名前</label>
                <input
                  className="input"
                  id="account-display-name"
                  placeholder="自分の名前"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label htmlFor="account-email">メールアドレス</label>
                <input
                  className="input"
                  id="account-email"
                  type="email"
                  value={accountEmail}
                  onChange={(event) => setAccountEmail(event.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="button button-primary" type="submit">
                  <Save size={16} />
                  保存
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ReportDetail({
  report,
  canManage,
  currentUserId,
  getAssetUrl,
  getUserName,
  loadProfilesForUsers,
  members,
  onChanged,
  onNotify
}: {
  report: Report | null;
  canManage: boolean;
  currentUserId: string | null;
  getAssetUrl: (path: string) => string;
  getUserName: (userId: string | null | undefined) => string;
  loadProfilesForUsers: (userIds: Array<string | null | undefined>) => Promise<void>;
  members: Member[];
  onChanged: () => Promise<void>;
  onNotify: (message: string, tone?: ToastTone) => void;
}) {
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ReportStatus>("open");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [recentAssigneeIds, setRecentAssigneeIds] = useState<string[]>(readRecentAssigneeIds);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [editingField, setEditingField] = useState<
    "status" | "assignees" | "description" | null
  >(null);
  const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false);
  const [attachmentModalUrl, setAttachmentModalUrl] = useState<string | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const assigneeMenuRef = useRef<HTMLDivElement | null>(null);
  const commentComposerRef = useRef<HTMLTextAreaElement | null>(null);

  function resizeCommentComposer(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }

  useEffect(() => {
    if (!report) {
      return;
    }

    setDescription(report.description);
    setStatus(report.status);
    setAssigneeIds(report.assignee_ids ?? []);
    setEditingField(null);
    setOpenCommentMenuId(null);
    setEditingCommentId(null);
    setEditingCommentBody("");
    setIsScreenshotModalOpen(false);
    loadComments(report.id);
  }, [report?.id]);

  useEffect(() => {
    if (!isScreenshotModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsScreenshotModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isScreenshotModalOpen]);

  useEffect(() => {
    if (editingField !== "status" && editingField !== "assignees") {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;

      if (
        !statusMenuRef.current?.contains(target) &&
        !assigneeMenuRef.current?.contains(target)
      ) {
        setEditingField(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEditingField(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingField]);

  useEffect(() => {
    if (!openCommentMenuId) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null;

      if (!target?.closest(".comment-menu-wrap")) {
        setOpenCommentMenuId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenCommentMenuId(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openCommentMenuId]);

  useEffect(() => {
    if (commentComposerRef.current) {
      resizeCommentComposer(commentComposerRef.current);
    }
  }, [commentBody]);

  async function loadComments(reportId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("report_comments")
      .select("*")
      .eq("report_id", reportId)
      .order("created_at", { ascending: true });

    if (error) {
      onNotify(error.message, "error");
      return;
    }

    const nextComments = (data ?? []) as Comment[];
    setComments(nextComments);
    await loadProfilesForUsers(nextComments.map((comment) => comment.created_by));
  }

  async function saveReportChanges(nextValues: {
    description?: string;
    status?: ReportStatus;
    assigneeIds?: string[];
  }) {
    if (!report) {
      return false;
    }

    const nextDescription = nextValues.description ?? description;
    const nextStatus = nextValues.status ?? status;
    const nextAssigneeIds = nextValues.assigneeIds ?? assigneeIds;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("reports")
      .update({
        description: nextDescription,
        status: nextStatus,
        assignee_ids: nextAssigneeIds
      })
      .eq("id", report.id);

    if (error) {
      onNotify(error.message, "error");
      return false;
    }

    await onChanged();
    return true;
  }

  async function notifyAddedAssignees(addedAssigneeIds: string[]) {
    if (!report || !addedAssigneeIds.length) {
      return;
    }

    const supabase = getSupabaseClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return;
    }

    try {
      const response = await fetch("/api/notifications/assignee", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          reportId: report.id,
          addedAssigneeIds
        })
      });

      if (!response.ok) {
        return;
      }
    } catch {
      return;
    }
  }

  async function handleStatusChange(nextStatus: ReportStatus) {
    setStatus(nextStatus);
    const saved = await saveReportChanges({ status: nextStatus });

    if (saved) {
      setEditingField(null);
    }
  }

  async function handleAssigneeToggle(memberId: string) {
    const previousAssigneeIds = assigneeIds;
    const nextAssigneeIds = assigneeIds.includes(memberId)
      ? assigneeIds.filter((assigneeId) => assigneeId !== memberId)
      : [...assigneeIds, memberId];
    const addedAssigneeIds = nextAssigneeIds.filter(
      (assigneeId) => !previousAssigneeIds.includes(assigneeId)
    );

    setAssigneeIds(nextAssigneeIds);
    const saved = await saveReportChanges({ assigneeIds: nextAssigneeIds });

    if (saved) {
      if (addedAssigneeIds.length) {
        const nextRecentAssigneeIds = moveAssigneeToRecentTop(
          recentAssigneeIds,
          addedAssigneeIds[0]
        );
        setRecentAssigneeIds(nextRecentAssigneeIds);
        writeRecentAssigneeIds(nextRecentAssigneeIds);
      }
      await notifyAddedAssignees(addedAssigneeIds);
    }
  }

  async function handleDescriptionBlur() {
    const nextDescription = description.trim();

    if (!report || nextDescription === report.description) {
      setEditingField(null);
      return;
    }

    const saved = await saveReportChanges({ description: nextDescription });

    if (saved) {
      setDescription(nextDescription);
      setEditingField(null);
    }
  }

  async function handleAddComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!report || !commentBody.trim()) {
      return;
    }

    const supabase = getSupabaseClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("report_comments").insert({
      report_id: report.id,
      body: commentBody.trim(),
      created_by: user?.id ?? null
    });

    if (error) {
      onNotify(error.message, "error");
      return;
    }

    setCommentBody("");
    await loadComments(report.id);
  }

  function handleCommentComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") {
      return;
    }

    if (event.metaKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }

    if (!event.shiftKey) {
      event.preventDefault();
    }
  }

  function handleEditComment(comment: Comment) {
    setOpenCommentMenuId(null);
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
  }

  async function handleSaveThreadComment(commentId: string) {
    if (!report || !editingCommentBody.trim()) {
      return;
    }

    const targetComment = comments.find((comment) => comment.id === commentId);
    if (!canManage && targetComment?.created_by !== currentUserId) {
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("report_comments")
      .update({ body: editingCommentBody.trim() })
      .eq("id", commentId)
      .eq("report_id", report.id);

    if (error) {
      onNotify(error.message, "error");
      return;
    }

    setEditingCommentId(null);
    setEditingCommentBody("");
    await loadComments(report.id);
  }

  async function handleDeleteThreadComment(commentId: string) {
    if (!report) {
      return;
    }

    const targetComment = comments.find((comment) => comment.id === commentId);
    if (!canManage && targetComment?.created_by !== currentUserId) {
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("report_comments")
      .delete()
      .eq("id", commentId)
      .eq("report_id", report.id);

    if (error) {
      onNotify(error.message, "error");
      return;
    }

    setOpenCommentMenuId(null);
    setEditingCommentId((currentId) => (currentId === commentId ? null : currentId));
    setEditingCommentBody("");
    await loadComments(report.id);
  }

  const orderedMembers = useMemo(() => {
    const memberOrder = new Map<string, number>();
    const orderedIds = [
      ...recentAssigneeIds,
      ...assigneeIds.filter((assigneeId) => !recentAssigneeIds.includes(assigneeId))
    ];

    orderedIds.forEach((assigneeId, index) => {
      memberOrder.set(assigneeId, index);
    });

    return members
      .map((member, index) => ({ index, member }))
      .sort((first, second) => {
        const firstOrder = memberOrder.get(first.member.id);
        const secondOrder = memberOrder.get(second.member.id);

        if (firstOrder !== undefined && secondOrder !== undefined) {
          return firstOrder - secondOrder;
        }

        if (firstOrder !== undefined) return -1;
        if (secondOrder !== undefined) return 1;

        return first.index - second.index;
      })
      .map(({ member }) => member);
  }, [assigneeIds, members, recentAssigneeIds]);

  if (!report) {
    return (
      <aside className="panel">
        <div className="detail-empty">
          <p>投稿を選択すると詳細とコメントを編集できます。</p>
        </div>
      </aside>
    );
  }

  const screenshotUrl = getAssetUrl(report.annotated_screenshot_path);
  const screenshotFocusStyle = getScreenshotFocusStyle(report, screenshotUrl);
  const screenshotAlt = report.description || report.page_title || "投稿されたスクリーンショット";
  const assigneeLabel = assigneeIds.length
    ? assigneeIds.map((assigneeId) => getUserName(assigneeId)).join(", ")
    : "未設定";

  return (
    <aside className="panel">
      <div className="detail-panel-body">
        <button
          aria-label="スクリーンショットを拡大"
          className="screenshot-button"
          type="button"
          onClick={() => setIsScreenshotModalOpen(true)}
        >
          {screenshotFocusStyle ? (
            <span
              aria-label={screenshotAlt}
              className="screenshot screenshot-focus"
              role="img"
              style={screenshotFocusStyle}
            />
          ) : (
            <img
              alt={screenshotAlt}
              className="screenshot"
              src={screenshotUrl}
            />
          )}
        </button>

        <section className="detail-list" aria-label="詳細">
          <div className="detail-row">
            <span className="detail-label">ステータス</span>
            <div className="detail-value">
              <div className="status-menu-wrap" ref={statusMenuRef}>
                <button
                  aria-expanded={editingField === "status"}
                  aria-haspopup="menu"
                  className={`status-button ${statusClass(status)}`}
                  type="button"
                  onClick={() =>
                    setEditingField((currentField) =>
                      currentField === "status" ? null : "status"
                    )
                  }
                >
                  {statusLabels[status]}
                </button>
                {editingField === "status" ? (
                  <div className="status-menu" role="menu">
                    {statuses.map((nextStatus) => (
                      <button
                        aria-current={nextStatus === status ? "true" : undefined}
                        className="status-menu-item"
                        key={nextStatus}
                        role="menuitem"
                        type="button"
                        onClick={() => handleStatusChange(nextStatus)}
                      >
                        <span className={statusClass(nextStatus)}>
                          {statusLabels[nextStatus]}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="detail-row detail-row-top">
            <span className="detail-label">内容</span>
            <div className="detail-value detail-value-body">
              <div className="detail-body-content">
                {editingField === "description" ? (
                  <textarea
                    autoFocus
                    className="detail-textarea"
                    value={description}
                    onBlur={handleDescriptionBlur}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                ) : (
                  <div
                    className="detail-editable detail-editable-text"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setEditingField("description");
                      }
                    }}
                    onClick={() => setEditingField("description")}
                  >
                    {description ? renderLinkedText(description, "detail-link") : "コメントなし"}
                  </div>
                )}
              </div>
              {report.attachment_paths?.length > 0 && (
                <div className="report-attachments">
                  {report.attachment_paths.map((path, i) => (
                    <button
                      className="report-attachment-btn"
                      key={i}
                      type="button"
                      onClick={() => setAttachmentModalUrl(getAssetUrl(path))}
                    >
                      <img
                        alt={`添付画像 ${i + 1}`}
                        className="report-attachment-thumb"
                        src={getAssetUrl(path)}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="detail-row">
            <span className="detail-label">投稿者</span>
            <div className="detail-value">{getUserName(report.created_by)}</div>
          </div>

          <div className="detail-row">
            <span className="detail-label">担当者</span>
            <div className="detail-value">
              <div className="assignee-menu-wrap" ref={assigneeMenuRef}>
                <button
                  aria-expanded={editingField === "assignees"}
                  aria-haspopup="menu"
                  className="assignee-button"
                  type="button"
                  onClick={() =>
                    setEditingField((currentField) =>
                      currentField === "assignees" ? null : "assignees"
                    )
                  }
                >
                  {assigneeLabel}
                </button>
                {editingField === "assignees" ? (
                  <div className="assignee-menu" role="menu">
                    {orderedMembers.map((member) => {
                      const memberName =
                        member.display_name.trim() || member.email || shortId(member.id);
                      const isSelected = assigneeIds.includes(member.id);

                      return (
                        <button
                          aria-checked={isSelected}
                          className={
                            isSelected
                              ? "assignee-menu-item assignee-menu-item-active"
                              : "assignee-menu-item"
                          }
                          key={member.id}
                          role="menuitemcheckbox"
                          type="button"
                          onClick={() => handleAssigneeToggle(member.id)}
                        >
                          <span>{memberName}</span>
                          {isSelected ? <Check aria-hidden="true" size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="detail-row">
            <span className="detail-label">更新日時</span>
            <div className="detail-value">{formatDate(report.updated_at)}</div>
          </div>

          <div className="detail-row detail-row-top">
            <span className="detail-label">ユーザー情報</span>
            <div className="detail-value">
              <div>デバイス: {displayDeviceInfo(report)}</div>
              <div>ブラウザ: {displayBrowserInfo(report.user_agent)}</div>
            </div>
          </div>

        </section>

        <section className="thread-section">
          <form className="thread-composer" onSubmit={handleAddComment}>
            <textarea
              className="thread-input"
              placeholder="コメントを追加"
              ref={commentComposerRef}
              rows={1}
              value={commentBody}
              onChange={(event) => {
                setCommentBody(event.target.value);
                resizeCommentComposer(event.currentTarget);
              }}
              onKeyDown={handleCommentComposerKeyDown}
            />
            <button className="thread-submit" disabled={!commentBody.trim()} type="submit">
              送信
            </button>
          </form>

          {comments.length ? (
            <div className="thread-list">
              {comments.map((comment) => {
                const authorName = getUserName(comment.created_by);
                const canEditComment = canManage || comment.created_by === currentUserId;

                return (
                  <article className="thread-item" key={comment.id}>
                    <div className="thread-content">
                      <div className="thread-header">
                        <div className="thread-meta">
                          <strong>{authorName}</strong>
                          <span>{formatDate(comment.created_at)}</span>
                        </div>
                        {canEditComment ? (
                          <div className="comment-menu-wrap">
                            <button
                              aria-label="コメントメニュー"
                              className="comment-menu-button"
                              type="button"
                              onClick={() =>
                                setOpenCommentMenuId((currentId) =>
                                  currentId === comment.id ? null : comment.id
                                )
                              }
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {openCommentMenuId === comment.id ? (
                              <div className="comment-menu" role="menu">
                                <button
                                  className="comment-menu-item"
                                  role="menuitem"
                                  type="button"
                                  onClick={() => handleEditComment(comment)}
                                >
                                  <Pencil size={14} />
                                  編集
                                </button>
                                <button
                                  className="comment-menu-item comment-menu-item-danger"
                                  role="menuitem"
                                  type="button"
                                  onClick={() => handleDeleteThreadComment(comment.id)}
                                >
                                  <Trash2 size={14} />
                                  削除
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {editingCommentId === comment.id ? (
                        <div className="thread-edit">
                          <textarea
                            autoFocus
                            className="thread-edit-textarea"
                            value={editingCommentBody}
                            onChange={(event) => setEditingCommentBody(event.target.value)}
                          />
                          <div className="thread-edit-actions">
                            <button
                              className="button button-ghost"
                              type="button"
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditingCommentBody("");
                              }}
                            >
                              キャンセル
                            </button>
                            <button
                              className="button button-primary"
                              disabled={!editingCommentBody.trim()}
                              type="button"
                              onClick={() => handleSaveThreadComment(comment.id)}
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p>{renderLinkedText(comment.body, "thread-link")}</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
      {isScreenshotModalOpen
        ? createPortal(
        <div
          className="image-modal-backdrop"
          role="presentation"
          onClick={() => setIsScreenshotModalOpen(false)}
        >
          <section
            aria-label="スクリーンショット"
            aria-modal="true"
            className="image-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              aria-label="閉じる"
              className="modal-close image-modal-close"
              type="button"
              onClick={() => setIsScreenshotModalOpen(false)}
            >
              <X size={16} />
            </button>
            <img
              alt={screenshotAlt}
              className="image-modal-image"
              src={screenshotUrl}
            />
          </section>
        </div>,
            document.body
          )
        : null}
      {attachmentModalUrl
        ? createPortal(
        <div
          className="image-modal-backdrop"
          role="presentation"
          onClick={() => setAttachmentModalUrl(null)}
        >
          <section
            aria-label="添付画像"
            aria-modal="true"
            className="image-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              aria-label="閉じる"
              className="modal-close image-modal-close"
              type="button"
              onClick={() => setAttachmentModalUrl(null)}
            >
              <X size={16} />
            </button>
            <img
              alt="添付画像"
              className="image-modal-image"
              src={attachmentModalUrl}
            />
          </section>
        </div>,
            document.body
          )
        : null}
    </aside>
  );
}
