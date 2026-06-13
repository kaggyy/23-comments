"use client";

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { ChevronDown, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { shortId } from "@/lib/format";
import {
  getPublicAppUrl,
  getSupabaseClient,
  isSupabaseConfigured
} from "@/lib/supabase";

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
  login_id?: string;
  login_password?: string;
};

type MemberRole = "owner" | "member";

type Member = Omit<Profile, "login_id" | "login_password"> & {
  login_id: string;
  login_password: string;
  role: MemberRole;
};

type Report = {
  id: string;
  organization_id: string;
  project_id: string;
  status: string;
  screenshot_path: string;
  annotated_screenshot_path: string;
};

type ProjectMembership = {
  organization_id: string;
  project_id: string;
  user_id: string;
};

type LoadState = "loading" | "ready" | "error";
type ToastTone = "default" | "error";
type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};

type EditableMemberField = "display_name" | "email" | "login_id" | "login_password" | "role";
type EditingMemberCell = {
  memberId: string;
  field: EditableMemberField;
} | null;

const roleLabels: Record<MemberRole, string> = {
  owner: "編集",
  member: "閲覧"
};

function displayProjectName(name: string | null | undefined) {
  return name === "Website feedback" ? "Webサイトフィードバック" : name;
}

function displayMemberName(member: Member) {
  return member.display_name.trim() || member.email || shortId(member.id);
}

function displayMemberLoginId(member: Member) {
  return member.login_id.trim() || member.display_name.trim() || shortId(member.id);
}

function createDefaultProjectMemberships(projects: Project[], memberIds: string[]) {
  return projects.flatMap((project) =>
    memberIds.map((memberId) => ({
      organization_id: project.organization_id,
      project_id: project.id,
      user_id: memberId
    }))
  );
}

export function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [projectMemberships, setProjectMemberships] = useState<ProjectMembership[]>([]);
  const [activeSection, setActiveSection] = useState<"projects" | "members">("projects");
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] = useState("");
  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [managedProjectMemberIds, setManagedProjectMemberIds] = useState<string[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [isInviteRoleMenuOpen, setIsInviteRoleMenuOpen] = useState(false);
  const [editingMemberCell, setEditingMemberCell] = useState<EditingMemberCell>(null);
  const [editingMemberValue, setEditingMemberValue] = useState("");
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const inviteRoleMenuRef = useRef<HTMLDivElement | null>(null);

  const openReportCountsByProjectId = useMemo(() => {
    const counts = new Map<string, number>();

    for (const report of reports) {
      if (report.status === "open") {
        counts.set(report.project_id, (counts.get(report.project_id) ?? 0) + 1);
      }
    }

    return counts;
  }, [reports]);

  function showToast(messageText: string, tone: ToastTone = "default") {
    setToast({
      id: Date.now(),
      message: messageText,
      tone
    });
  }

  function openProject(projectId: string) {
    localStorage.setItem("selectedProjectId", projectId);
    router.push("/");
  }

  async function loadAdminDashboard() {
    if (!isSupabaseConfigured()) {
      setState("error");
      setMessage("Supabase設定が見つかりません。");
      return;
    }

    setState("loading");
    setMessage("");

    const supabase = getSupabaseClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/login");
      return;
    }

    setUser(session.user);

    const { data: membershipData, error: membershipError } = await supabase
      .from("memberships")
      .select("organization_id, role")
      .limit(1)
      .single();

    if (membershipError) {
      setState("error");
      setMessage(membershipError.message);
      return;
    }

    const organizationId = membershipData?.organization_id as string | undefined;
    if (!organizationId || membershipData?.role !== "owner") {
      router.replace("/");
      return;
    }

    const [
      organizationResult,
      projectsResult,
      membershipsResult,
      reportsResult,
      projectMembershipsResult
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, name")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("projects")
        .select("id, organization_id, name, url_pattern")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("memberships")
        .select("user_id, role")
        .eq("organization_id", organizationId),
      supabase
        .from("reports")
        .select("id, organization_id, project_id, status, screenshot_path, annotated_screenshot_path")
        .eq("organization_id", organizationId),
      supabase
        .from("project_memberships")
        .select("organization_id, project_id, user_id")
        .eq("organization_id", organizationId)
    ]);

    const firstError =
      organizationResult.error ??
      projectsResult.error ??
      membershipsResult.error ??
      reportsResult.error;

    if (firstError) {
      setState("error");
      setMessage(firstError.message);
      return;
    }

    const nextProjects = (projectsResult.data ?? []) as Project[];
    const memberIds = (membershipsResult.data ?? [])
      .map((membership) => membership.user_id)
      .filter(Boolean);
    const nextProjectMemberships = projectMembershipsResult.error
      ? createDefaultProjectMemberships(nextProjects, memberIds)
      : ((projectMembershipsResult.data ?? []) as ProjectMembership[]);
    let profilesResult: {
      data: Profile[] | null;
      error: { message: string } | null;
    } = memberIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name, email, login_id, login_password")
          .in("id", memberIds)
      : { data: [], error: null };

    if (profilesResult.error?.message.includes("profiles.login_id")) {
      profilesResult = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", memberIds);
    }

    if (profilesResult.error) {
      setState("error");
      setMessage(profilesResult.error.message);
      return;
    }

    const profiles = (profilesResult.data ?? []) as Profile[];
    setOrganization(organizationResult.data as Organization);
    setProjects(nextProjects);
    setReports((reportsResult.data ?? []) as Report[]);
    setProjectMemberships(nextProjectMemberships);
    setMembers(
      memberIds.map((memberId) => {
        const profile = profiles.find((nextProfile) => nextProfile.id === memberId);
        const membership = membershipsResult.data?.find(
          (nextMembership) => nextMembership.user_id === memberId
        );

        return {
          ...(profile ?? {
            id: memberId,
            display_name: "",
            email: null,
            login_id: "",
            login_password: ""
          }),
          login_id: profile?.login_id || profile?.display_name || "",
          login_password: profile?.login_password || "",
          role: membership?.role === "owner" ? "owner" : "member"
        };
      })
    );
    setState("ready");
  }

  useEffect(() => {
    void loadAdminDashboard();
  }, []);

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
    if (!openProjectMenuId && !isInviteRoleMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;

      if (openProjectMenuId && !projectMenuRef.current?.contains(target)) {
        setOpenProjectMenuId(null);
      }

      if (isInviteRoleMenuOpen && !inviteRoleMenuRef.current?.contains(target)) {
        setIsInviteRoleMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenProjectMenuId(null);
        setIsInviteRoleMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInviteRoleMenuOpen, openProjectMenuId]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || !user || !newProjectName.trim()) {
      return;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        organization_id: organization.id,
        name: newProjectName.trim(),
        created_by: user.id
      })
      .select("id")
      .single();

    if (error) {
      showToast(error.message, "error");
      return;
    }

    const projectId = (data as { id: string } | null)?.id;
    if (projectId && members.length) {
      const { error: membershipError } = await supabase.from("project_memberships").insert(
        members.map((member) => ({
          organization_id: organization.id,
          project_id: projectId,
          user_id: member.id
        }))
      );

      if (membershipError) {
        showToast(membershipError.message, "error");
        return;
      }
    }

    setNewProjectName("");
    setIsProjectModalOpen(false);
    await loadAdminDashboard();
  }

  async function handleDeleteProject() {
    if (!projectToDelete || !organization || projectDeleteConfirmation !== "削除") {
      return;
    }

    const supabase = getSupabaseClient();
    const targetProject = projectToDelete;
    const targetReports = reports.filter((report) => report.project_id === targetProject.id);
    const assetPaths = targetReports
      .flatMap((report) => [report.screenshot_path, report.annotated_screenshot_path])
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
    await loadAdminDashboard();
  }

  function openProjectMemberModal(project: Project) {
    setOpenProjectMenuId(null);
    setProjectToManage(project);
    setManagedProjectMemberIds(
      projectMemberships
        .filter((membership) => membership.project_id === project.id)
        .map((membership) => membership.user_id)
    );
  }

  async function handleSaveProjectMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || !projectToManage) {
      return;
    }

    const supabase = getSupabaseClient();
    const currentIds = projectMemberships
      .filter((membership) => membership.project_id === projectToManage.id)
      .map((membership) => membership.user_id);
    const nextIdSet = new Set(managedProjectMemberIds);
    const currentIdSet = new Set(currentIds);
    const idsToAdd = managedProjectMemberIds.filter((memberId) => !currentIdSet.has(memberId));
    const idsToRemove = currentIds.filter((memberId) => !nextIdSet.has(memberId));

    if (idsToAdd.length) {
      const { error } = await supabase.from("project_memberships").insert(
        idsToAdd.map((memberId) => ({
          organization_id: organization.id,
          project_id: projectToManage.id,
          user_id: memberId
        }))
      );

      if (error) {
        showToast(error.message, "error");
        return;
      }
    }

    if (idsToRemove.length) {
      const { error } = await supabase
        .from("project_memberships")
        .delete()
        .eq("organization_id", organization.id)
        .eq("project_id", projectToManage.id)
        .in("user_id", idsToRemove);

      if (error) {
        showToast(error.message, "error");
        return;
      }
    }

    setProjectToManage(null);
    await loadAdminDashboard();
  }

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization) {
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
      setIsInviteModalOpen(false);
      await loadAdminDashboard();
      showToast("招待リンクを発行しました。");
    } catch {
      showToast("招待リンクを発行できませんでした。", "error");
    }
  }

  function startEditingMember(member: Member, field: EditableMemberField) {
    const value =
      field === "role"
        ? member.role
        : field === "email"
          ? member.email ?? ""
          : member[field];

    setEditingMemberCell({ memberId: member.id, field });
    setEditingMemberValue(value);
  }

  function cancelEditingMember() {
    setEditingMemberCell(null);
    setEditingMemberValue("");
  }

  async function saveMemberCell(member: Member, field: EditableMemberField, value: string) {
    if (!organization || savingMemberId) {
      return;
    }

    const nextMember = {
      ...member,
      [field]: field === "role" ? (value as MemberRole) : value.trim()
    };
    const nextDisplayName = nextMember.display_name.trim();
    const nextEmail = (nextMember.email ?? "").trim();
    const nextLoginId = nextMember.login_id.trim();
    const nextPassword = nextMember.login_password.trim();

    if (!nextDisplayName || !nextEmail || !nextLoginId) {
      showToast("メンバー情報が不正です。", "error");
      cancelEditingMember();
      return;
    }

    setSavingMemberId(member.id);

    const supabase = getSupabaseClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      setSavingMemberId(null);
      showToast("認証が必要です。", "error");
      return;
    }

    try {
      const response = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          memberId: member.id,
          displayName: nextDisplayName,
          email: nextEmail,
          loginId: nextLoginId,
          password: nextPassword,
          role: nextMember.role
        })
      });
      const result = (await response.json().catch(() => null)) as
        | { member?: Member; error?: string }
        | null;

      if (!response.ok || !result?.member) {
        showToast(result?.error ?? "メンバー情報を保存できませんでした。", "error");
        return;
      }

      setMembers((currentMembers) =>
        currentMembers.map((currentMember) =>
          currentMember.id === member.id ? result.member! : currentMember
        )
      );
      showToast("保存しました。");
    } catch {
      showToast("メンバー情報を保存できませんでした。", "error");
    } finally {
      setSavingMemberId(null);
      cancelEditingMember();
    }
  }

  function handleMemberEditKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      cancelEditingMember();
    }
  }

  function renderEditableMemberCell(member: Member, field: EditableMemberField) {
    const isEditing =
      editingMemberCell?.memberId === member.id && editingMemberCell.field === field;
    const isSaving = savingMemberId === member.id;

    if (field === "role") {
      if (isEditing) {
        return (
          <div
            className="admin-member-role-menu-wrap"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                cancelEditingMember();
              }
            }}
          >
            <button
              autoFocus
              aria-expanded="true"
              aria-haspopup="menu"
              className="member-role-button admin-member-role-button"
              disabled={isSaving}
              type="button"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancelEditingMember();
                }
              }}
            >
              <span>{roleLabels[member.role]}</span>
              <ChevronDown size={16} />
            </button>
            <div className="member-role-menu admin-member-role-menu" role="menu">
              <button
                className={
                  member.role === "owner"
                    ? "member-role-menu-item member-role-menu-item-selected"
                    : "member-role-menu-item"
                }
                role="menuitem"
                type="button"
                onClick={() => void saveMemberCell(member, field, "owner")}
              >
                編集
              </button>
              <button
                className={
                  member.role === "member"
                    ? "member-role-menu-item member-role-menu-item-selected"
                    : "member-role-menu-item"
                }
                role="menuitem"
                type="button"
                onClick={() => void saveMemberCell(member, field, "member")}
              >
                閲覧
              </button>
            </div>
          </div>
        );
      }

      return (
        <button
          className="admin-member-cell-button"
          disabled={isSaving}
          type="button"
          onClick={() => startEditingMember(member, field)}
        >
          {roleLabels[member.role]}
        </button>
      );
    }

    const value = field === "email" ? member.email ?? "" : member[field];
    const label =
      field === "email" ? member.email || "メールアドレス未登録" : field === "login_id" ? displayMemberLoginId(member) : value;

    if (isEditing) {
      return (
        <input
          autoFocus
          className="admin-member-cell-input"
          disabled={isSaving}
          type="text"
          value={editingMemberValue}
          onBlur={() => void saveMemberCell(member, field, editingMemberValue)}
          onChange={(event) => setEditingMemberValue(event.target.value)}
          onKeyDown={handleMemberEditKeyDown}
        />
      );
    }

    return (
      <button
        className="admin-member-cell-button"
        disabled={isSaving}
        type="button"
        onClick={() => startEditingMember(member, field)}
      >
        {label}
      </button>
    );
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
    <main className="admin-shell">
      {toast ? (
        <div className="toast-viewport" role="status" aria-live="polite">
          <div className={toast.tone === "error" ? "toast toast-error" : "toast"}>
            {toast.message}
          </div>
        </div>
      ) : null}
      <aside className="admin-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <img alt="" src="/icon.svg" />
          </span>
          <span>23 comments</span>
        </Link>
        <nav className="admin-nav" aria-label="管理">
          <button
            className={activeSection === "projects" ? "admin-nav-item admin-nav-item-active" : "admin-nav-item"}
            type="button"
            onClick={() => setActiveSection("projects")}
          >
            プロジェクト
          </button>
          <button
            className={activeSection === "members" ? "admin-nav-item admin-nav-item-active" : "admin-nav-item"}
            type="button"
            onClick={() => setActiveSection("members")}
          >
            メンバー
          </button>
        </nav>
      </aside>
      <section className="admin-main">
        {activeSection === "projects" ? (
          <>
            <header className="admin-header">
              <h1>プロジェクト</h1>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setIsProjectModalOpen(true)}
              >
                <Plus size={16} />
                作成
              </button>
            </header>
            <div className="admin-project-grid">
              {projects.map((project) => (
                <article
                  className="admin-project-card"
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openProject(project.id);
                    }
                  }}
                >
                  <div className="admin-project-card-main">
                    <h2>{displayProjectName(project.name)}</h2>
                    <span className="admin-project-status-tag">
                      未着手 {openReportCountsByProjectId.get(project.id) ?? 0}
                    </span>
                  </div>
                  <div
                    className="admin-project-menu-wrap"
                    ref={openProjectMenuId === project.id ? projectMenuRef : null}
                  >
                    <button
                      aria-expanded={openProjectMenuId === project.id}
                      aria-haspopup="menu"
                      aria-label="プロジェクトメニュー"
                      className="project-menu-button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenProjectMenuId((currentId) =>
                          currentId === project.id ? null : project.id
                        );
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {openProjectMenuId === project.id ? (
                      <div
                        className="project-menu admin-project-menu"
                        role="menu"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          className="project-menu-item project-menu-item-danger"
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            setProjectToDelete(project);
                          }}
                        >
                          プロジェクト削除
                        </button>
                        <button
                          className="project-menu-item"
                          role="menuitem"
                          type="button"
                          onClick={() => openProjectMemberModal(project)}
                        >
                          メンバー管理
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            <header className="admin-header">
              <h1>メンバー</h1>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setIsInviteModalOpen(true)}
              >
                招待
              </button>
            </header>
            <div className="admin-table-wrap">
              <table className="table admin-member-table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>メールアドレス</th>
                    <th>ID</th>
                    <th>パスワード</th>
                    <th>権限</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr className="table-row" key={member.id}>
                      <td>{renderEditableMemberCell(member, "display_name")}</td>
                      <td>{renderEditableMemberCell(member, "email")}</td>
                      <td>{renderEditableMemberCell(member, "login_id")}</td>
                      <td>{renderEditableMemberCell(member, "login_password")}</td>
                      <td>{renderEditableMemberCell(member, "role")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

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
                <label htmlFor="admin-project-name">プロジェクト名</label>
                <input
                  className="input"
                  id="admin-project-name"
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="button button-primary" type="submit">
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
              <div className="delete-preview">{displayProjectName(projectToDelete.name)}</div>
              <input
                aria-label="削除確認"
                className="input"
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

      {projectToManage ? (
        <div className="modal-backdrop" onClick={() => setProjectToManage(null)}>
          <section
            aria-labelledby="project-members-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="project-members-dialog-title">メンバー管理</h2>
              </div>
              <button
                aria-label="閉じる"
                className="modal-close"
                type="button"
                onClick={() => setProjectToManage(null)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleSaveProjectMembers}>
              <div className="admin-member-check-list">
                {members.map((member) => {
                  const memberName = displayMemberName(member);
                  const checked = managedProjectMemberIds.includes(member.id);

                  return (
                    <label className="admin-member-check" key={member.id}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={(event) => {
                          setManagedProjectMemberIds((currentIds) =>
                            event.target.checked
                              ? [...currentIds, member.id]
                              : currentIds.filter((memberId) => memberId !== member.id)
                          );
                        }}
                      />
                      <span>{memberName}</span>
                    </label>
                  );
                })}
              </div>
              <div className="modal-actions">
                <button className="button button-primary" type="submit">
                  保存
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isInviteModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsInviteModalOpen(false)}>
          <section
            aria-labelledby="invite-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="invite-dialog-title">招待</h2>
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
              <div className="form-row">
                <label htmlFor="admin-invite-name">名前</label>
                <input
                  className="input"
                  id="admin-invite-name"
                  value={inviteDisplayName}
                  onChange={(event) => setInviteDisplayName(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="admin-invite-email">メールアドレス</label>
                <input
                  className="input"
                  id="admin-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="admin-invite-password">パスワード</label>
                <input
                  className="input"
                  id="admin-invite-password"
                  minLength={6}
                  type="password"
                  value={invitePassword}
                  onChange={(event) => setInvitePassword(event.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label id="admin-invite-role-label">権限</label>
                <div className="invite-role-menu-wrap" ref={inviteRoleMenuRef}>
                  <button
                    aria-expanded={isInviteRoleMenuOpen}
                    aria-haspopup="menu"
                    aria-labelledby="admin-invite-role-label"
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
                        閲覧
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
                        編集
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="modal-actions">
                <button className="button button-primary" type="submit">
                  招待
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
