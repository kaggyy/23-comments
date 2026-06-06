"use client";

import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Copy,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

type Organization = {
  id: string;
  name: string;
  invite_token: string;
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
type ReportSortKey = "status" | "updated_at";
type SortDirection = "asc" | "desc";
type ToastTone = "default" | "error";
type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};
type ReportSort = {
  key: ReportSortKey;
  direction: SortDirection;
};
type SplitPaneStyle = CSSProperties & {
  "--split-left": string;
};
type ScreenshotFocusStyle = CSSProperties & {
  "--focus-aspect": string;
};

function displayProjectName(name: string | null | undefined) {
  return name === "Website feedback" ? "Webサイトフィードバック" : name;
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

function getCenteredBackgroundPosition(focusRatio: number, zoom: number) {
  if (zoom <= 1) {
    return 50;
  }

  const position = (0.5 - focusRatio * zoom) / (1 - zoom);
  return Math.min(100, Math.max(0, position * 100));
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

  const markedWidth = bounds.maxX - bounds.minX;
  const markedHeight = bounds.maxY - bounds.minY;
  const padding = Math.max(72 * devicePixelRatio, Math.max(markedWidth, markedHeight) * 0.55);
  const focusCenterX = (bounds.minX + bounds.maxX) / 2;
  const focusCenterY = (bounds.minY + bounds.maxY) / 2;
  const targetWidth = Math.min(imageWidth, markedWidth + padding * 2);
  const targetHeight = Math.min(imageHeight, markedHeight + padding * 2);
  const zoom = Math.max(
    1,
    Math.min(6, Math.min(imageWidth / targetWidth, imageHeight / targetHeight))
  );
  const positionX = getCenteredBackgroundPosition(focusCenterX / imageWidth, zoom);
  const positionY = getCenteredBackgroundPosition(focusCenterY / imageHeight, zoom);

  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundPosition: `${positionX}% ${positionY}%`,
    backgroundSize: `${zoom * 100}% auto`,
    "--focus-aspect": `${imageWidth} / ${imageHeight}`
  } satisfies ScreenshotFocusStyle;
}

export function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("all");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [reportToDelete, setReportToDelete] = useState<Report | null>(null);
  const [openStatusMenuReportId, setOpenStatusMenuReportId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [reportSort, setReportSort] = useState<ReportSort>({
    key: "updated_at",
    direction: "desc"
  });
  const [splitLeftPercent, setSplitLeftPercent] = useState(50);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const visibleReports = useMemo(() => {
    const filteredReports = reports.filter((report) => {
      const matchesProject =
        selectedProjectId === "all" || report.project_id === selectedProjectId;
      const matchesStatus =
        statusFilter === "all" || report.status === statusFilter;

      return matchesProject && matchesStatus;
    });

    const direction = reportSort.direction === "asc" ? 1 : -1;

    return [...filteredReports].sort((firstReport, secondReport) => {
      const primaryComparison =
        reportSort.key === "status"
          ? statuses.indexOf(firstReport.status) - statuses.indexOf(secondReport.status)
          : Date.parse(firstReport.updated_at) - Date.parse(secondReport.updated_at);

      if (primaryComparison !== 0) {
        return primaryComparison * direction;
      }

      const updatedAtFallback =
        Date.parse(secondReport.updated_at) - Date.parse(firstReport.updated_at);

      if (updatedAtFallback !== 0) {
        return updatedAtFallback;
      }

      return firstReport.id.localeCompare(secondReport.id);
    });
  }, [reportSort.direction, reportSort.key, reports, selectedProjectId, statusFilter]);

  const selectedReport = useMemo(
    () => visibleReports.find((report) => report.id === selectedReportId) ?? null,
    [selectedReportId, visibleReports]
  );

  function showToast(messageText: string, tone: ToastTone = "default") {
    setToast({
      id: Date.now(),
      message: messageText,
      tone
    });
  }

  useEffect(() => {
    if (
      selectedReportId &&
      !visibleReports.some((report) => report.id === selectedReportId)
    ) {
      setSelectedReportId(null);
    }
  }, [selectedReportId, visibleReports]);

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

  function handleSortChange(key: ReportSortKey) {
    setReportSort((currentSort) => {
      if (currentSort.key === key) {
        return {
          key,
          direction: currentSort.direction === "asc" ? "desc" : "asc"
        };
      }

      return {
        key,
        direction: key === "updated_at" ? "desc" : "asc"
      };
    });
  }

  async function handleTableStatusChange(report: Report, nextStatus: ReportStatus) {
    setOpenStatusMenuReportId(null);

    if (nextStatus === report.status) {
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("reports")
      .update({ status: nextStatus })
      .eq("id", report.id)
      .eq("organization_id", report.organization_id)
      .select()
      .single();

    if (error) {
      showToast(error.message, "error");
      return;
    }

    await loadReports(report.organization_id);
  }

  function renderSortIcon(key: ReportSortKey) {
    if (reportSort.key !== key) {
      return <ArrowDownUp aria-hidden="true" size={14} />;
    }

    return reportSort.direction === "asc" ? (
      <ChevronUp aria-hidden="true" size={14} />
    ) : (
      <ChevronDown aria-hidden="true" size={14} />
    );
  }

  function getSortLabel(key: ReportSortKey) {
    if (reportSort.key !== key) {
      return "並び替えなし";
    }

    return reportSort.direction === "asc" ? "昇順" : "降順";
  }

  function getAriaSort(key: ReportSortKey) {
    if (reportSort.key !== key) {
      return "none";
    }

    return reportSort.direction === "asc" ? "ascending" : "descending";
  }

  function updateSplitFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const container = event.currentTarget.parentElement;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
    setSplitLeftPercent(Math.min(75, Math.max(28, nextPercent)));
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
      setSplitLeftPercent((current) => Math.max(28, current - 3));
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSplitLeftPercent((current) => Math.min(75, current + 3));
    }

    if (event.key === "Home") {
      event.preventDefault();
      setSplitLeftPercent(28);
    }

    if (event.key === "End") {
      event.preventDefault();
      setSplitLeftPercent(75);
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
      .select("user_id")
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

        return (
          profile ?? {
            id: memberId,
            display_name: "",
            email: null
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
    await loadOwnProfile(currentSession.user);

    let { data: memberships, error: membershipsError } = await supabase
      .from("memberships")
      .select("organization_id")
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
        .select("organization_id")
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

    if (!organizationId) {
      setState("error");
      setMessage("ワークスペースを作成できませんでした。");
      return;
    }

    const [{ data: organizationData, error: orgError }, projectsResult] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("id, name, invite_token")
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
    setProjects((projectsResult.data ?? []) as Project[]);
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
      .order("updated_at", { ascending: false });

    if (error) {
      showToast(error.message, "error");
      return;
    }

    const nextReports = (data ?? []) as unknown as Report[];
    setReports(nextReports);
    await loadProfilesForUsers(nextReports.map((report) => report.created_by));
    setSelectedReportId((current) => {
      if (current && nextReports.some((report) => report.id === current)) {
        return current;
      }

      return nextReports[0]?.id ?? null;
    });
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

    if (!organization) {
      return;
    }

    const url = `${getPublicAppUrl().replace(/\/$/, "")}/invite/${organization.invite_token}`;
    setIsInviteModalOpen(false);
    try {
      await navigator.clipboard?.writeText(url);
      showToast("招待リンクをコピーしました。");
    } catch {
      showToast("招待リンクをコピーできませんでした。", "error");
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || !user || !newProjectName.trim()) {
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
    if (!reportToDelete) {
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
    setSelectedReportId((currentReportId) =>
      currentReportId === targetReport.id ? null : currentReportId
    );
    await loadReports(targetReport.organization_id);
  }

  async function handleDeleteProject() {
    if (!projectToDelete || !organization) {
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
    setSelectedProjectId("all");
    setSelectedReportId(null);
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
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img alt="" src="/icon.svg" />
          </span>
          <span>23 comments</span>
        </div>
        <div className="topbar-actions">
          <div className="tooltip-wrap">
            <button
              aria-label="招待"
              className="topbar-icon-button topbar-icon-button-primary"
              type="button"
              onClick={() => {
                void loadMembers();
                setIsInviteModalOpen(true);
              }}
            >
              <Copy size={17} />
            </button>
            <span className="tooltip" role="tooltip">
              招待
            </span>
          </div>
          <div className="tooltip-wrap">
            <button
              aria-label="アカウント"
              className="topbar-icon-button"
              type="button"
              onClick={() => {
                setIsAccountModalOpen(true);
              }}
            >
              <UserRound size={17} />
            </button>
            <span className="tooltip" role="tooltip">
              アカウント
            </span>
          </div>
        </div>
      </header>

      <div className="page">
        <section className="toolbar">
          <div className="toolbar-group">
            <select
              className="select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as ReportStatus | "all")
              }
            >
              <option value="all">すべてのステータス</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="all">すべてのプロジェクト</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {displayProjectName(project.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar-group">
            <button
              className="button"
              type="button"
              onClick={() => {
                setIsProjectModalOpen(true);
              }}
            >
              <Plus size={16} />
              プロジェクト作成
            </button>
            <button
              className="button button-danger"
              disabled={!selectedProject}
              type="button"
              onClick={() => {
                if (!selectedProject) {
                  return;
                }

                setProjectToDelete(selectedProject);
              }}
            >
              <Trash2 size={16} />
              プロジェクト削除
            </button>
          </div>
        </section>

        <section
          className="mail-split"
          style={{ "--split-left": `${splitLeftPercent}%` } as SplitPaneStyle}
        >
          <div className="mail-list-pane">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>内容</th>
                    <th aria-sort={getAriaSort("status")}>
                      <button
                        aria-label={`ステータスで並び替え、現在は${getSortLabel("status")}`}
                        className="table-sort-button"
                        type="button"
                        onClick={() => handleSortChange("status")}
                      >
                        <span>ステータス</span>
                        {renderSortIcon("status")}
                      </button>
                    </th>
                    <th>投稿者</th>
                    <th aria-sort={getAriaSort("updated_at")}>
                      <button
                        aria-label={`更新日時で並び替え、現在は${getSortLabel("updated_at")}`}
                        className="table-sort-button"
                        type="button"
                        onClick={() => handleSortChange("updated_at")}
                      >
                        <span>更新日時</span>
                        {renderSortIcon("updated_at")}
                      </button>
                    </th>
                    <th className="table-action-column">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReports.map((report) => (
                    <tr
                      className={
                        report.id === selectedReportId
                          ? "table-row table-row-selected"
                          : "table-row"
                      }
                      key={report.id}
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <td>
                        <div className="title-cell">
                          <strong>
                            {report.description || report.page_title || "コメントなし"}
                          </strong>
                        </div>
                      </td>
                      <td>
                        <div className="status-menu-wrap">
                          <button
                            aria-expanded={openStatusMenuReportId === report.id}
                            aria-haspopup="menu"
                            className={`status status-button ${statusClass(report.status)}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenStatusMenuReportId((currentId) =>
                                currentId === report.id ? null : report.id
                              );
                            }}
                          >
                            {statusLabels[report.status]}
                          </button>
                          {openStatusMenuReportId === report.id ? (
                            <div className="status-menu" role="menu">
                              {statuses.map((nextStatus) => (
                                <button
                                  className="status-menu-item"
                                  key={nextStatus}
                                  role="menuitem"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleTableStatusChange(report, nextStatus);
                                  }}
                                >
                                  <span className={statusClass(nextStatus)}>
                                    {statusLabels[nextStatus]}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>{displayUserName(report.created_by, profilesById)}</td>
                      <td>{formatDate(report.updated_at)}</td>
                      <td className="table-action-column">
                        <button
                          aria-label="コメントを削除"
                          className="row-icon-button"
                          title="削除"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setReportToDelete(report);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibleReports.length ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="detail-empty">
                          まだ投稿はありません。Chrome拡張からページをキャプチャしてください。
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div
            aria-label="一覧と詳細の幅を調整"
            aria-orientation="vertical"
            aria-valuemax={75}
            aria-valuemin={28}
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
            <ReportDetail
              getAssetUrl={getAssetUrl}
              getUserName={(userId) => displayUserName(userId, profilesById)}
              loadProfilesForUsers={loadProfilesForUsers}
              onChanged={() => loadReports()}
              onNotify={showToast}
              report={selectedReport}
            />
          </div>
        </section>
      </div>

      {isInviteModalOpen ? (
        <div className="modal-backdrop">
          <section
            aria-labelledby="invite-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <h2 id="invite-dialog-title">メンバーを招待</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleCreateInvite}>
              <section className="member-section" aria-label="メンバー">
                <h3>メンバー</h3>
                {members.length ? (
                  <ul className="member-list">
                    {members.map((member) => {
                      const memberName =
                        member.display_name.trim() || member.email || shortId(member.id);

                      return (
                        <li className="member-item" key={member.id}>
                          <span className="member-name">{memberName}</span>
                          <span className="member-email">
                            {member.email || "メールアドレス未登録"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="member-empty">メンバーはいません。</p>
                )}
              </section>
              <div className="modal-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                >
                  キャンセル
                </button>
                <button className="button button-primary" type="submit">
                  <Copy size={16} />
                  招待リンクをコピー
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {reportToDelete ? (
        <div className="modal-backdrop">
          <section
            aria-labelledby="delete-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
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
                <button
                  className="button"
                  type="button"
                  onClick={() => setReportToDelete(null)}
                >
                  キャンセル
                </button>
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
        <div className="modal-backdrop">
          <section
            aria-labelledby="project-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
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
                <button
                  className="button"
                  type="button"
                  onClick={() => setIsProjectModalOpen(false)}
                >
                  キャンセル
                </button>
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
        <div className="modal-backdrop">
          <section
            aria-labelledby="project-delete-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <h2 id="project-delete-dialog-title">プロジェクトを削除</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setProjectToDelete(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-copy">
                このプロジェクトと、紐づくコメントをすべて削除します。
              </p>
              <div className="delete-preview">
                {displayProjectName(projectToDelete.name)}
                <br />
                {reports.filter((report) => report.project_id === projectToDelete.id).length}
                件のコメント
              </div>
              <div className="modal-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => setProjectToDelete(null)}
                >
                  キャンセル
                </button>
                <button className="button button-danger" type="button" onClick={handleDeleteProject}>
                  <Trash2 size={16} />
                  削除
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isAccountModalOpen ? (
        <div className="modal-backdrop">
          <section
            aria-labelledby="account-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
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
              <div className="modal-actions modal-actions-between">
                <button className="button button-danger" type="button" onClick={handleLogout}>
                  <LogOut size={16} />
                  ログアウト
                </button>
                <div className="modal-actions">
                  <button
                    className="button"
                    type="button"
                    onClick={() => setIsAccountModalOpen(false)}
                  >
                    キャンセル
                  </button>
                  <button className="button button-primary" type="submit">
                    <Save size={16} />
                    保存
                  </button>
                </div>
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
  getAssetUrl,
  getUserName,
  loadProfilesForUsers,
  onChanged,
  onNotify
}: {
  report: Report | null;
  getAssetUrl: (path: string) => string;
  getUserName: (userId: string | null | undefined) => string;
  loadProfilesForUsers: (userIds: Array<string | null | undefined>) => Promise<void>;
  onChanged: () => Promise<void>;
  onNotify: (message: string, tone?: ToastTone) => void;
}) {
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ReportStatus>("open");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [editingField, setEditingField] = useState<"status" | "description" | null>(
    null
  );
  const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false);

  useEffect(() => {
    if (!report) {
      return;
    }

    setDescription(report.description);
    setStatus(report.status);
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
  }) {
    if (!report) {
      return false;
    }

    const nextDescription = nextValues.description ?? description;
    const nextStatus = nextValues.status ?? status;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("reports")
      .update({
        description: nextDescription,
        status: nextStatus
      })
      .eq("id", report.id);

    if (error) {
      onNotify(error.message, "error");
      return false;
    }

    await onChanged();
    return true;
  }

  async function handleStatusChange(nextStatus: ReportStatus) {
    setStatus(nextStatus);
    const saved = await saveReportChanges({ status: nextStatus });

    if (saved) {
      setEditingField(null);
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

  function handleEditComment(comment: Comment) {
    setOpenCommentMenuId(null);
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
  }

  async function handleSaveThreadComment(commentId: string) {
    if (!report || !editingCommentBody.trim()) {
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

  if (!report) {
    return (
      <aside className="panel">
        <div className="detail-empty">
          <MessageSquare size={26} />
          <p>投稿を選択すると詳細とコメントを編集できます。</p>
        </div>
      </aside>
    );
  }

  const screenshotUrl = getAssetUrl(report.annotated_screenshot_path);
  const screenshotFocusStyle = getScreenshotFocusStyle(report, screenshotUrl);
  const screenshotAlt = report.description || report.page_title || "投稿されたスクリーンショット";

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
              {editingField === "status" ? (
                <select
                  autoFocus
                  className="detail-select"
                  value={status}
                  onBlur={() => setEditingField(null)}
                  onChange={(event) =>
                    handleStatusChange(event.target.value as ReportStatus)
                  }
                >
                  {statuses.map((nextStatus) => (
                    <option key={nextStatus} value={nextStatus}>
                      {statusLabels[nextStatus]}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  className="detail-editable"
                  type="button"
                  onClick={() => setEditingField("status")}
                >
                  <span className={statusClass(status)}>{statusLabels[status]}</span>
                </button>
              )}
            </div>
          </div>

          <div className="detail-row detail-row-top">
            <span className="detail-label">内容</span>
            <div className="detail-value">
              {editingField === "description" ? (
                <textarea
                  autoFocus
                  className="detail-textarea"
                  value={description}
                  onBlur={handleDescriptionBlur}
                  onChange={(event) => setDescription(event.target.value)}
                />
              ) : (
                <button
                  className="detail-editable detail-editable-text"
                  type="button"
                  onClick={() => setEditingField("description")}
                >
                  {description || "コメントなし"}
                </button>
              )}
            </div>
          </div>

        </section>

        <section className="thread-section">
          <form className="thread-composer" onSubmit={handleAddComment}>
            <input
              className="thread-input"
              placeholder="コメントを追加"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <button className="thread-submit" disabled={!commentBody.trim()} type="submit">
              送信
            </button>
          </form>

          {comments.length ? (
            <div className="thread-list">
              {comments.map((comment) => {
                const authorName = getUserName(comment.created_by);

                return (
                  <article className="thread-item" key={comment.id}>
                    <div className="thread-content">
                      <div className="thread-header">
                        <div className="thread-meta">
                          <strong>{authorName}</strong>
                          <span>{formatDate(comment.created_at)}</span>
                        </div>
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
                        <p>{comment.body}</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
      {isScreenshotModalOpen ? (
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
        </div>
      ) : null}
    </aside>
  );
}
