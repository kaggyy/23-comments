import type { Session } from "@supabase/supabase-js";
import { LogIn, Save } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createExtensionSupabase } from "@/lib/supabase";
import {
  getSettings,
  saveSettings,
  type ExtensionSettings
} from "@/lib/storage";

type CaptureResponse = {
  ok: boolean;
  error?: string;
};

const defaultSupabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const defaultSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export function Popup() {
  const [settings, setSettings] = useState<ExtensionSettings>({});
  const [supabaseUrl, setSupabaseUrl] = useState(defaultSupabaseUrl);
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(defaultSupabaseAnonKey);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const captureStartedRef = useRef(false);

  const isConfigured = useMemo(
    () => Boolean(settings.supabaseUrl && settings.supabaseAnonKey),
    [settings.supabaseAnonKey, settings.supabaseUrl]
  );

  const isLoggedIn = Boolean(settings.session?.access_token);

  useEffect(() => {
    if (!isLoggedIn || !selectedProjectId || captureStartedRef.current) {
      return;
    }

    captureStartedRef.current = true;
    handleCapture();
  }, [isLoggedIn, selectedProjectId]);

  useEffect(() => {
    async function boot() {
      const stored = await getSettings();
      const withDefaults = {
        ...stored,
        supabaseUrl: stored.supabaseUrl || defaultSupabaseUrl,
        supabaseAnonKey: stored.supabaseAnonKey || defaultSupabaseAnonKey
      };
      setSettings(withDefaults);
      setSupabaseUrl(withDefaults.supabaseUrl ?? "");
      setSupabaseAnonKey(withDefaults.supabaseAnonKey ?? "");
      setSelectedProjectId(withDefaults.selectedProject?.id ?? "");

      if (withDefaults.session) {
        await loadProjects(withDefaults);
      }
    }

    boot();
  }, []);

  async function persistSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      supabaseUrl: supabaseUrl.trim(),
      supabaseAnonKey: supabaseAnonKey.trim()
    };
    await saveSettings(next);
    setSettings((current) => ({ ...current, ...next }));
    setMessage("設定を保存しました。");
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const nextSettings = {
        ...settings,
        supabaseUrl,
        supabaseAnonKey
      };
      const supabase = createExtensionSupabase(nextSettings);
      const result =
        authMode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error || !result.data.session) {
        setMessage(result.error?.message ?? "登録確認メールを確認してください。");
        return;
      }

      const session = result.data.session as Session;
      const stored = { ...nextSettings, session };
      await saveSettings(stored);
      setSettings(stored);
      await loadProjects(stored);
      setMessage("ログインしました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "認証に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function loadProjects(sourceSettings = settings) {
    setBusy(true);
    setMessage("");

    try {
      const supabase = createExtensionSupabase(sourceSettings);

      if (!sourceSettings.session) {
        throw new Error("プロジェクトの読み込みにはログインが必要です。");
      }

      await supabase.auth.setSession({
        access_token: sourceSettings.session.access_token,
        refresh_token: sourceSettings.session.refresh_token
      });

      let { data: memberships, error: membershipError } = await supabase
        .from("memberships")
        .select("organization_id")
        .limit(1);

      if (membershipError) {
        throw membershipError;
      }

      if (!memberships?.length) {
        const { error } = await supabase.rpc("create_workspace", {
          workspace_name: `${sourceSettings.session.user.email ?? "ユーザー"} のワークスペース`,
          project_name: "Webサイトフィードバック"
        });

        if (error) {
          throw error;
        }

        const retry = await supabase
          .from("memberships")
          .select("organization_id")
          .limit(1);
        memberships = retry.data;
        membershipError = retry.error;

        if (membershipError) {
          throw membershipError;
        }
      }

      const organizationId = memberships?.[0]?.organization_id;

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

      const options = (data ?? []).map((project) => ({
        id: project.id,
        organizationId: project.organization_id,
        name: project.name
      }));

      const selected =
        options.find((project) => project.id === sourceSettings.selectedProject?.id) ??
        options[0];

      if (selected) {
        setSelectedProjectId(selected.id);
        await saveSettings({ selectedProject: selected });
        setSettings((current) => ({ ...current, selectedProject: selected }));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "プロジェクトを読み込めませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function handleCapture() {
    setBusy(true);
    setMessage("");

    try {
      const response = (await chrome.runtime.sendMessage({
        type: "START_CAPTURE"
      })) as CaptureResponse;

      if (!response?.ok) {
        setMessage(response?.error ?? "キャプチャに失敗しました。");
        captureStartedRef.current = false;
        return;
      }

      setMessage("コメント画面を開きました。");
      window.close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "キャプチャに失敗しました。");
      captureStartedRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="popup">
      <header className="header">
        <span className="mark" aria-hidden="true">
          <img alt="" src="icon.svg" />
        </span>
        <div>
          <h1>23 comments</h1>
          <p>表示中ページにコメントします。</p>
        </div>
      </header>

      {!isConfigured ? (
        <form className="form" onSubmit={persistSettings}>
          <div className="field">
            <label htmlFor="supabase-url">Supabase URL</label>
            <input
              className="input"
              id="supabase-url"
              value={supabaseUrl}
              onChange={(event) => setSupabaseUrl(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="supabase-key">Supabase公開キー</label>
            <input
              className="input"
              id="supabase-key"
              value={supabaseAnonKey}
              onChange={(event) => setSupabaseAnonKey(event.target.value)}
              required
            />
          </div>
          <button className="button button-primary" type="submit">
            <Save size={16} />
            設定を保存
          </button>
        </form>
      ) : null}

      {isConfigured && !isLoggedIn ? (
        <form className="form" onSubmit={handleAuth}>
          <div className="field">
            <label htmlFor="email">メールアドレス</label>
            <input
              className="input"
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">パスワード</label>
            <input
              className="input"
              id="password"
              type="password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="row">
            <button className="button button-primary" disabled={busy} type="submit">
              <LogIn size={16} />
              {authMode === "signin" ? "ログイン" : "登録"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() =>
                setAuthMode(authMode === "signin" ? "signup" : "signin")
              }
            >
              {authMode === "signin" ? "登録" : "ログイン"}
            </button>
          </div>
        </form>
      ) : null}

      {isLoggedIn ? (
        <section className="form opening-state">
          <div className="notice">
            {busy || selectedProjectId
              ? "コメント画面を開いています..."
              : "プロジェクトを準備しています..."}
          </div>
        </section>
      ) : null}

      {message ? <div className="notice">{message}</div> : null}
    </main>
  );
}
