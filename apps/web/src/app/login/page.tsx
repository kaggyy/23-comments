"use client";

import { LogIn } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const supabase = getSupabaseClient();
      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      router.push(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログインに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">設定が必要です</p>
          <h1>Supabase設定が見つかりません</h1>
          <p className="subtitle">
            NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定して、
            管理画面を再起動してください。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">23 comments</p>
        <h1>{mode === "signin" ? "ログイン" : "アカウント作成"}</h1>
        <p className="subtitle">
          管理画面とChrome拡張で同じアカウントを使います。
        </p>

        <form className="panel-body" onSubmit={handleSubmit}>
          <div className="form-row">
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
          <div className="form-row">
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
          {message ? <div className="notice">{message}</div> : null}
          <button className="button button-primary" disabled={busy} type="submit">
            <LogIn size={16} />
            {busy ? "処理中..." : mode === "signin" ? "ログイン" : "登録"}
          </button>
          <button
            className="button button-ghost"
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "新規登録に切り替え"
              : "ログインに切り替え"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main aria-label="読み込み中" className="loading-shell">
          <span aria-hidden="true" className="loading-spinner" />
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
