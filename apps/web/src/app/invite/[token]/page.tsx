"use client";

import { CheckCircle2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function acceptInvite() {
      if (!isSupabaseConfigured()) {
        setMessage("Supabase設定が見つかりません。");
        setLoading(false);
        return;
      }

      const supabase = getSupabaseClient();
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace(`/login?next=/invite/${params.token}`);
        return;
      }

      const { error } = await supabase.rpc("accept_invitation", {
        invitation_token: params.token
      });

      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }

      router.replace("/");
    }

    acceptInvite();
  }, [params.token, router]);

  return loading ? (
    <main aria-label="読み込み中" className="loading-shell">
      <span aria-hidden="true" className="loading-spinner" />
    </main>
  ) : (
    <main className="auth-shell">
      <section className="auth-card">
        <CheckCircle2 size={28} />
        <h1>招待</h1>
        <p className="subtitle">{message}</p>
      </section>
    </main>
  );
}
