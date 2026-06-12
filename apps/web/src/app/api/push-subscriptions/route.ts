import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type PushSubscriptionPayload = {
  subscription?: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
};

function isPushSubscription(
  value: PushSubscriptionPayload["subscription"]
): value is NonNullable<PushSubscriptionPayload["subscription"]> {
  return Boolean(
    value &&
    typeof value.endpoint === "string" &&
    value.endpoint.length > 0 &&
    typeof value.keys?.p256dh === "string" &&
    typeof value.keys?.auth === "string"
  );
}

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Supabase設定が見つかりません。" },
      { status: 500 }
    );
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as PushSubscriptionPayload | null;
  const subscription = payload?.subscription;

  if (!isPushSubscription(subscription)) {
    return NextResponse.json({ error: "通知設定が不正です。" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorization
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const { error } = await supabase
    .from("web_push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        subscription
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
