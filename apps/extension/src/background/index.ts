import { reportCreateSchema } from "@comment-tool/shared";
import { createAuthenticatedSupabase } from "@/lib/supabase";
import {
  clearSession,
  getSettings,
  saveSettings,
  type ExtensionSettings,
  type StoredProject
} from "@/lib/storage";

type OpenAnnotatorPayload = {
  screenshotDataUrl: string;
  projects: StoredProject[];
  selectedProject: StoredProject;
  tab: {
    id: number;
    title: string;
    url: string;
  };
};

type CaptureTarget = {
  frameId: number;
  pageUrl: string;
};

type SubmitPayload = {
  description: string;
  pageUrl: string;
  pageTitle: string;
  screenshotDataUrl: string;
  annotatedScreenshotDataUrl: string;
  annotations: unknown[];
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  userAgent: string;
};

type RuntimeMessage =
  | { type: "START_CAPTURE" }
  | { type: "PING_CONTENT" }
  | { type: "SELECT_PROJECT"; payload: { project: StoredProject } }
  | { type: "LOGOUT" }
  | { type: "SUBMIT_REPORT"; payload: SubmitPayload };

const mobileSimulatorExtensionId = "ckejmhbmlajgoklhgbapkiccekfoccmk";

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "START_CAPTURE") {
    startCapture().then(sendResponse);
    return true;
  }

  if (message.type === "SUBMIT_REPORT") {
    submitReport(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === "SELECT_PROJECT") {
    selectProject(message.payload.project).then(sendResponse);
    return true;
  }

  if (message.type === "LOGOUT") {
    logout().then(sendResponse);
    return true;
  }

  if (message.type === "PING_CONTENT") {
    sendResponse({ ok: true });
  }

  return false;
});

async function startCapture() {
  try {
    const settings = await getSettings();
    const captureContext = await getCaptureContext(settings);

    if (!captureContext.selectedProject) {
      return { ok: false, error: "キャプチャ前にプロジェクトを選択してください。" };
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url) {
      return { ok: false, error: "アクティブなタブが見つかりません。" };
    }

    if (isRestrictedUrl(tab.url) && !isMobileSimulatorUrl(tab.url)) {
      return {
        ok: false,
        error: "このページはChrome拡張ではキャプチャできません。"
      };
    }

    const captureTarget = await getCaptureTarget(tab);
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    await sendAnnotatorMessage(tab.id, {
      screenshotDataUrl,
      projects: captureContext.projects,
      selectedProject: captureContext.selectedProject,
      tab: {
        id: tab.id,
        title: tab.title ?? "",
        url: captureTarget.pageUrl
      }
    }, captureTarget.frameId);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "キャプチャに失敗しました。"
    };
  }
}

async function getCaptureContext(settings: ExtensionSettings) {
  const supabase = await createAuthenticatedSupabase(settings);

  let organizationId = settings.selectedProject?.organizationId;

  if (!organizationId) {
    const { data: memberships, error } = await supabase
      .from("memberships")
      .select("organization_id")
      .limit(1);

    if (error) {
      throw error;
    }

    organizationId = memberships?.[0]?.organization_id;
  }

  if (!organizationId) {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { error } = await supabase.rpc("create_workspace", {
      workspace_name: `${user?.email ?? "ユーザー"} のワークスペース`,
      project_name: "Webサイトフィードバック"
    });

    if (error) {
      throw error;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("memberships")
      .select("organization_id")
      .limit(1);

    if (membershipError) {
      throw membershipError;
    }

    organizationId = memberships?.[0]?.organization_id;
  }

  if (!organizationId) {
    throw new Error("ワークスペースが見つかりません。");
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, organization_id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const projects = (data ?? []).map((project) => ({
    id: project.id,
    organizationId: project.organization_id,
    name: project.name
  }));
  const selectedProject =
    projects.find((project) => project.id === settings.selectedProject?.id) ??
    projects[0];

  if (selectedProject) {
    await saveSettings({ selectedProject });
  }

  return {
    projects,
    selectedProject
  };
}

async function getCaptureTarget(tab: chrome.tabs.Tab): Promise<CaptureTarget> {
  if (!tab.id || !tab.url) {
    throw new Error("アクティブなタブが見つかりません。");
  }

  if (!isMobileSimulatorUrl(tab.url)) {
    return {
      frameId: 0,
      pageUrl: tab.url
    };
  }

  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  const frame = frames?.find(
    (candidate) => candidate.parentFrameId !== -1 && isMobileSimulatorFrameUrl(candidate.url)
  );

  if (!frame) {
    throw new Error("Mobile Simulator内のページに接続できませんでした。");
  }

  return {
    frameId: frame.frameId,
    pageUrl: frame.url
  };
}

async function sendAnnotatorMessage(
  tabId: number,
  payload: OpenAnnotatorPayload,
  frameId: number
) {
  const message = {
    type: "OPEN_ANNOTATOR",
    payload
  };

  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["assets/content.js"]
    });
    await waitForContentScript(tabId, frameId);
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  }
}

async function waitForContentScript(tabId: number, frameId: number) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "PING_CONTENT"
      }, { frameId });

      if (response?.ok) {
        return;
      }
    } catch {
      await delay(100);
    }
  }

  throw new Error(
    "このページに接続できませんでした。ページを再読み込みして再度お試しいただくか、ブラウザやシステムページではなく通常のhttps://ページでお試しください。"
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function selectProject(project: StoredProject) {
  await saveSettings({ selectedProject: project });
  return { ok: true };
}

async function logout() {
  await clearSession();
  return { ok: true };
}

async function submitReport(payload: SubmitPayload) {
  try {
    const settings = await getSettings();
    const selectedProject = settings.selectedProject;

    if (!selectedProject) {
      return { ok: false, error: "保存前にプロジェクトを選択してください。" };
    }

    const parsed = reportCreateSchema.parse({
      ...payload,
      title: createReportTitle(payload),
      organizationId: selectedProject.organizationId,
      projectId: selectedProject.id
    });

    const supabase = await createAuthenticatedSupabase(settings);
    const {
      data: { user }
    } = await supabase.auth.getUser();

    const basePath = `${parsed.organizationId}/${parsed.projectId}/${Date.now()}-${crypto.randomUUID()}`;
    const screenshotPath = `${basePath}-raw.png`;
    const annotatedPath = `${basePath}-annotated.png`;

    await uploadImage(parsed.screenshotDataUrl, screenshotPath);
    await uploadImage(parsed.annotatedScreenshotDataUrl, annotatedPath);

    const { data, error } = await supabase
      .from("reports")
      .insert({
        organization_id: parsed.organizationId,
        project_id: parsed.projectId,
        title: parsed.title,
        description: parsed.description,
        page_url: parsed.pageUrl,
        page_title: parsed.pageTitle,
        screenshot_path: screenshotPath,
        annotated_screenshot_path: annotatedPath,
        annotations: parsed.annotations,
        viewport_width: parsed.viewport.width,
        viewport_height: parsed.viewport.height,
        device_pixel_ratio: parsed.viewport.devicePixelRatio,
        user_agent: parsed.userAgent,
        browser_metadata: {
          source: "chrome-extension"
        },
        created_by: user?.id ?? null
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return { ok: true, reportId: data.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "保存に失敗しました。"
    };
  }
}

async function uploadImage(dataUrl: string, path: string) {
  const settings = await getSettings();
  const supabase = await createAuthenticatedSupabase(settings);
  const blob = await dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage
    .from("report-assets")
    .upload(path, blob, {
      contentType: "image/png",
      upsert: false
    });

  if (error) {
    throw error;
  }
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function isRestrictedUrl(url: string) {
  return /^(chrome|chrome-extension|edge|about):/i.test(url);
}

function isMobileSimulatorUrl(url: string) {
  return url.startsWith(`chrome-extension://${mobileSimulatorExtensionId}/`);
}

function isMobileSimulatorFrameUrl(url: string) {
  return /^https?:/i.test(url);
}

function createReportTitle(payload: SubmitPayload) {
  const commentTitle = payload.description.trim().replace(/\s+/g, " ").slice(0, 80);

  if (commentTitle) {
    return commentTitle;
  }

  if (payload.pageTitle.trim()) {
    return payload.pageTitle.trim().slice(0, 80);
  }

  return new URL(payload.pageUrl).hostname;
}
