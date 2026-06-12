import type { RectAnnotation } from "@comment-tool/shared";
import { Image as ImageIcon, LogOut, Send, Trash2, Undo2, X } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState, useCallback, ClipboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";

type StoredProject = {
  id: string;
  organizationId: string;
  name: string;
};

type Member = {
  id: string;
  displayName: string;
  email: string | null;
};

type OpenAnnotatorPayload = {
  screenshotDataUrl: string;
  projects: StoredProject[];
  selectedProject: StoredProject;
  members: Member[];
  tab: {
    id: number;
    title: string;
    url: string;
  };
};

type SubmitResponse = {
  ok: boolean;
  reportId?: string;
  error?: string;
};

type BasicResponse = {
  ok: boolean;
  error?: string;
};

function displayProjectName(name: string) {
  return name === "Website feedback" ? "Webサイトフィードバック" : name;
}

function displayMemberName(member: Member) {
  return member.displayName.trim() || member.email || member.id.slice(0, 8);
}

type RuntimeMessage = {
  type: "OPEN_ANNOTATOR";
  payload: OpenAnnotatorPayload;
} | {
  type: "PING_CONTENT";
};

declare global {
  interface Window {
    __commentToolRoot?: Root;
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "PING_CONTENT") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "OPEN_ANNOTATOR") {
    openAnnotator(message.payload);
    sendResponse({ ok: true });
  }

  return false;
});

function openAnnotator(payload: OpenAnnotatorPayload) {
  document.getElementById("comment-tool-overlay-host")?.remove();

  const host = document.createElement("div");
  host.id = "comment-tool-overlay-host";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = overlayStyles;
  const rootElement = document.createElement("div");
  shadow.append(style, rootElement);

  window.__commentToolRoot?.unmount();
  window.__commentToolRoot = createRoot(rootElement);
  window.__commentToolRoot.render(
    <Annotator payload={payload} onClose={() => host.remove()} />
  );
}

function Annotator({
  payload,
  onClose
}: {
  payload: OpenAnnotatorPayload;
  onClose: () => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; dataUrl: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [annotations, setAnnotations] = useState<RectAnnotation[]>([]);
  const [draft, setDraft] = useState<RectAnnotation | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [projects] = useState<StoredProject[]>(payload.projects);
  const [members] = useState<Member[]>(payload.members);
  const [selectedProjectId, setSelectedProjectId] = useState(
    payload.selectedProject.id
  );
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");

  useEffect(() => {
    function syncCanvasSize() {
      const image = imageRef.current;
      const canvas = canvasRef.current;

      if (!image || !canvas) {
        return;
      }

      const rect = image.getBoundingClientRect();
      const parentRect = image.parentElement?.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.style.left = `${parentRect ? rect.left - parentRect.left : 0}px`;
      canvas.style.top = `${parentRect ? rect.top - parentRect.top : 0}px`;
      redraw();
    }

    syncCanvasSize();
    window.addEventListener("resize", syncCanvasSize);
    return () => window.removeEventListener("resize", syncCanvasSize);
  }, [imageReady]);

  useEffect(() => {
    redraw();
  }, [annotations, draft, imageReady]);

  function redraw() {
    const canvas = canvasRef.current;
    const image = imageRef.current;

    if (!canvas || !image || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / image.naturalWidth;
    const scaleY = canvas.height / image.naturalHeight;

    for (const annotation of [...annotations, ...(draft ? [draft] : [])]) {
      context.strokeStyle = annotation.stroke;
      context.lineWidth = annotation.strokeWidth;
      context.setLineDash(draft?.id === annotation.id ? [8, 6] : []);
      context.strokeRect(
        annotation.x * scaleX,
        annotation.y * scaleY,
        annotation.width * scaleX,
        annotation.height * scaleY
      );
    }

    context.setLineDash([]);
  }

  function getNaturalPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const image = imageRef.current;

    if (!canvas || !image) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const scaleX = image.naturalWidth / rect.width;
    const scaleY = image.naturalHeight / rect.height;

    return {
      x: Math.max(0, Math.min(image.naturalWidth, displayX * scaleX)),
      y: Math.max(0, Math.min(image.naturalHeight, displayY * scaleY))
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getNaturalPoint(event);
    setStartPoint(point);
    setDraft({
      id: crypto.randomUUID(),
      type: "rect",
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      stroke: "#dd5b00",
      strokeWidth: 3
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!startPoint) {
      return;
    }

    const point = getNaturalPoint(event);
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        width: Math.abs(point.x - startPoint.x),
        height: Math.abs(point.y - startPoint.y)
      };
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (draft && draft.width > 8 && draft.height > 8) {
      setAnnotations((current) => [...current, draft]);
    }

    setDraft(null);
    setStartPoint(null);
  }

  const addFilesAsAttachments = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const remaining = 5 - attachments.length;
    const toAdd = list.slice(0, remaining);

    const results = await Promise.all(
      toAdd.map(
        (file) =>
          new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, dataUrl: reader.result as string });
            reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
            reader.readAsDataURL(file);
          })
      )
    );

    setAttachments((current) => [...current, ...results]);
  }, [attachments.length]);

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      addFilesAsAttachments(imageFiles);
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setMessage("");

    try {
      const annotatedScreenshotDataUrl = await renderAnnotatedImage();
      const selectedAssignee = members.find((member) => member.id === selectedAssigneeId);
      const response = (await chrome.runtime.sendMessage({
        type: "SUBMIT_REPORT",
        payload: {
          description: description.trim(),
          pageUrl: payload.tab.url,
          pageTitle: payload.tab.title,
          screenshotDataUrl: payload.screenshotDataUrl,
          annotatedScreenshotDataUrl,
          annotations,
          attachmentDataUrls: attachments.map((a) => a.dataUrl),
          assigneeIds: selectedAssignee ? [selectedAssignee.id] : [],
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1
          },
          userAgent: navigator.userAgent
        }
      })) as SubmitResponse;

      if (!response?.ok) {
        setMessage(response?.error ?? "保存に失敗しました。");
        return;
      }

      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleProjectChange(projectId: string) {
    const selectedProject = projects.find((project) => project.id === projectId);

    if (!selectedProject) {
      return;
    }

    setSelectedProjectId(projectId);
    setMessage("");

    const response = (await chrome.runtime.sendMessage({
      type: "SELECT_PROJECT",
      payload: {
        project: selectedProject
      }
    })) as BasicResponse;

    if (!response?.ok) {
      setMessage(response?.error ?? "プロジェクトを変更できませんでした。");
    }
  }

  async function handleLogout() {
    const response = (await chrome.runtime.sendMessage({
      type: "LOGOUT"
    })) as BasicResponse;

    if (!response?.ok) {
      setMessage(response?.error ?? "ログアウトできませんでした。");
      return;
    }

    onClose();
  }

  async function renderAnnotatedImage() {
    const image = await loadImage(payload.screenshotDataUrl);
    const output = document.createElement("canvas");
    output.width = image.naturalWidth;
    output.height = image.naturalHeight;
    const context = output.getContext("2d");

    if (!context) {
      throw new Error("キャンバスを利用できません。");
    }

    context.drawImage(image, 0, 0);

    for (const annotation of annotations) {
      context.strokeStyle = annotation.stroke;
      context.lineWidth = annotation.strokeWidth;
      context.strokeRect(
        annotation.x,
        annotation.y,
        annotation.width,
        annotation.height
      );
    }

    return output.toDataURL("image/png");
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <section className="stage">
        <div className="stage-toolbar">
          <div className="toolbar-actions">
            <button
              className="icon-button"
              title="元に戻す"
              type="button"
              onClick={() => setAnnotations((current) => current.slice(0, -1))}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              title="削除"
              type="button"
              onClick={() => setAnnotations([])}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <div className="screenshot-wrap">
          <img
            ref={imageRef}
            alt=""
            className="screenshot"
            src={payload.screenshotDataUrl}
            onLoad={() => setImageReady(true)}
          />
          <canvas
            ref={canvasRef}
            className="annotation-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </div>
      </section>

      <aside className="side-panel">
        <div className="side-header">
          <div>
            <h1>コメントを投稿</h1>
          </div>
          <button className="icon-button" title="閉じる" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <label>
          プロジェクト
          <select
            className="select"
            value={selectedProjectId}
            onChange={(event) => handleProjectChange(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {displayProjectName(project.name)}
              </option>
            ))}
          </select>
        </label>

        <label>
          担当者
          <select
            className="select"
            value={selectedAssigneeId}
            onChange={(event) => setSelectedAssigneeId(event.target.value)}
          >
            <option value="">未選択</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {displayMemberName(member)}
              </option>
            ))}
          </select>
        </label>

        <label>
          内容
          <div className="textarea-wrap">
            <textarea
              className="textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onPaste={handlePaste}
              placeholder="具体的なフィードバックを入力"
            />
            <button
              className="attach-image-button"
              title="画像を添付"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={15} />
            </button>
            <input
              ref={fileInputRef}
              accept="image/*"
              multiple
              style={{ display: "none" }}
              type="file"
              onChange={(event) => {
                if (event.target.files) {
                  addFilesAsAttachments(event.target.files);
                  event.target.value = "";
                }
              }}
            />
          </div>
        </label>

        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((attachment, index) => (
              <div className="attachment-item" key={index}>
                <img alt={attachment.name} className="attachment-thumb" src={attachment.dataUrl} />
                <button
                  aria-label="削除"
                  className="attachment-remove"
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {message ? <div className="notice">{message}</div> : null}

        <button
          className="button button-primary"
          disabled={busy}
          type="button"
          onClick={handleSubmit}
        >
          <Send size={16} />
          {busy ? "保存中..." : "コメントを保存"}
        </button>

        <button
          className="button button-secondary logout-button"
          type="button"
          onClick={handleLogout}
        >
          <LogOut size={16} />
          ログアウト
        </button>
      </aside>
    </div>
  );
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("スクリーンショットを読み込めませんでした。"));
    image.src = src;
  });
}

const overlayStyles = `
  * {
    box-sizing: border-box;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 0;
    color: #1a1a1a;
    background: rgb(246 245 244 / 98%);
    font-family: "Notion Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
  }

  .stage {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    padding: 20px;
  }

  .stage-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 12px;
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
  }

  .icon-button {
    display: inline-grid;
    width: 36px;
    height: 36px;
    place-items: center;
    color: #37352f;
    background: #ffffff;
    border: 1px solid #c8c4be;
    border-radius: 8px;
    cursor: pointer;
  }

  .screenshot-wrap {
    position: relative;
    display: grid;
    min-height: 0;
    place-items: center;
    overflow: auto;
    background: #ffffff;
    border: 1px solid #e5e3df;
    border-radius: 12px;
  }

  .screenshot {
    display: block;
    max-width: 100%;
    max-height: calc(100vh - 96px);
    user-select: none;
  }

  .annotation-canvas {
    position: absolute;
    cursor: crosshair;
    touch-action: none;
  }

  .side-panel {
    display: grid;
    grid-auto-rows: max-content;
    gap: 14px;
    padding: 20px;
    background: #ffffff;
    border-left: 1px solid #e5e3df;
  }

  .side-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }

  h1 {
    margin: 0;
    color: #1a1a1a;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
  }

  label {
    display: grid;
    gap: 6px;
    color: #787671;
    font-size: 12px;
    font-weight: 600;
  }

  .input,
  .select,
  .textarea {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    color: #1a1a1a;
    background: #ffffff;
    border: 1px solid #c8c4be;
    border-radius: 8px;
    outline: none;
  }

  .textarea {
    min-height: 120px;
    resize: vertical;
  }

  .textarea-wrap {
    position: relative;
  }

  .textarea-wrap .textarea {
    width: 100%;
    padding-bottom: 32px;
  }

  .attach-image-button {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: inline-grid;
    width: 26px;
    height: 26px;
    place-items: center;
    color: #787671;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
  }

  .attach-image-button:hover {
    color: #37352f;
    background: #f0eeec;
  }

  .attachment-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: -4px;
  }

  .attachment-item {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #e5e3df;
    flex-shrink: 0;
  }

  .attachment-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .attachment-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    display: inline-grid;
    width: 16px;
    height: 16px;
    place-items: center;
    color: #ffffff;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    padding: 0;
  }

  .attachment-remove:hover {
    background: rgba(0, 0, 0, 0.75);
  }

  .input:focus,
  .select:focus,
  .textarea:focus {
    border-color: #5645d4;
    box-shadow: 0 0 0 2px rgb(86 69 212 / 12%);
  }

  .notice {
    padding: 10px 12px;
    color: #37352f;
    background: #ffe8d4;
    border: 1px solid #f0c7a8;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.4;
  }

  .button {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid #000000;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  .button-primary {
    color: #ffffff;
    background: #000000;
  }

  .button-secondary {
    color: #37352f;
    background: #ffffff;
    border-color: #c8c4be;
  }

  .logout-button {
    margin-top: auto;
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  @media (max-width: 820px) {
    .overlay {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .side-panel {
      border-top: 1px solid #e5e3df;
      border-left: 0;
    }
  }
`;
