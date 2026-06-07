import type { Session } from "@supabase/supabase-js";
import { Eye, EyeOff, LogIn, Save } from "lucide-react";
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
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
      if (authMode === "signup") {
        const result = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName.trim()
            }
          }
        });

        if (result.error) {
          setMessage(result.error.message);
          return;
        }

        if (result.data.session) {
          const session = result.data.session as Session;
          const { error } = await supabase.from("profiles").upsert(
            {
              id: session.user.id,
              display_name: displayName.trim(),
              email: session.user.email ?? email
            },
            { onConflict: "id" }
          );

          if (error) {
            setMessage(error.message);
            return;
          }

          await supabase.auth.signOut();
        }

        setAuthMode("signin");
        setPassword("");
        setMessage("新規登録が完了しました。再度ログインしてください。");
        return;
      }

      const result = await supabase.auth.signInWithPassword({ email, password });

      if (result.error || !result.data.session) {
        setMessage(result.error?.message ?? "ログインに失敗しました。");
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
          <h1>{authMode === "signup" ? "新規登録" : "23 comments"}</h1>
          {authMode === "signin" ? <p>表示中ページにコメントします。</p> : null}
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
          {authMode === "signup" ? (
            <div className="field">
              <label htmlFor="display-name">あなたの名前</label>
              <input
                className="input"
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="password">パスワード</label>
            <div className="password-field">
              <input
                className="input password-input"
                id="password"
                type={isPasswordVisible ? "text" : "password"}
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                aria-label={
                  isPasswordVisible ? "パスワードを非表示" : "パスワードを表示"
                }
                className="password-toggle"
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
              >
                {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="auth-actions">
            <button className="button button-primary" disabled={busy} type="submit">
              {authMode === "signin" ? <LogIn size={16} /> : null}
              {authMode === "signin" ? "ログイン" : "新規登録"}
            </button>
            {authMode === "signin" ? (
              <button
                className="button-link"
                type="button"
                onClick={() => setAuthMode("signup")}
              >
                新規登録
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {message ? <div className="notice">{message}</div> : null}
    </main>
  );
}
