"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isInviteAvailable, setIsInviteAvailable] = useState(true);

  useEffect(() => {
    async function loadInvitation() {
      if (!isSupabaseConfigured()) {
        setMessage("Supabase設定が見つかりません。");
        setLoading(false);
        return;
      }

      const supabase = getSupabaseClient();
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (session) {
        const { error } = await supabase.rpc("accept_invitation", {
          invitation_token: params.token
        });

        if (error) {
          setMessage(error.message);
          setLoading(false);
          return;
        }

        router.replace("/");
        return;
      }

      const { data, error } = await supabase.rpc("get_invitation_info", {
        invitation_token: params.token
      });

      if (error) {
        setMessage(error.message);
        setIsInviteAvailable(false);
        setLoading(false);
        return;
      }

      if (!data || (Array.isArray(data) && !data.length)) {
        setMessage("招待が見つかりません");
        setIsInviteAvailable(false);
        setLoading(false);
        return;
      }

      const invitation = Array.isArray(data) ? data[0] : data;
      setEmail(invitation.email ?? "");
      setDisplayName(invitation.display_name ?? "");
      setLoading(false);
    }

    loadInvitation();
  }, [params.token, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const supabase = getSupabaseClient();
      if (loginId.trim() !== displayName) {
        setMessage("IDまたはパスワードが正しくありません。");
        return;
      }

      const result = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (result.error) {
        setMessage("IDまたはパスワードが正しくありません。");
        return;
      }

      const session = result.data.session;
      if (!session) {
        setMessage("IDまたはパスワードが正しくありません。");
        return;
      }

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: session.user.id,
          display_name: displayName,
          email
        },
        { onConflict: "id" }
      );

      if (profileError) {
        setMessage(profileError.message);
        return;
      }

      const { error: inviteError } = await supabase.rpc("accept_invitation", {
        invitation_token: params.token
      });

      if (inviteError) {
        setMessage(inviteError.message);
        return;
      }

      router.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログインに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main aria-label="読み込み中" className="loading-shell">
        <span aria-hidden="true" className="loading-spinner" />
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>23のワークスペースに招待されました！</h1>

        {isInviteAvailable ? (
          <form className="panel-body" onSubmit={handleSubmit}>
            <div className="form-row">
              <label htmlFor="login-id">ID</label>
              <input
                className="input"
                id="login-id"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="password">パスワード</label>
              <input
                className="input"
                id="password"
                minLength={6}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {message ? <div className="notice">{message}</div> : null}
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? "処理中..." : "ログイン"}
            </button>
          </form>
        ) : (
          <div className="notice">{message}</div>
        )}
      </section>
    </main>
  );
}
