import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type InviteRequest = {
  organizationId?: unknown;
  email?: unknown;
  displayName?: unknown;
  password?: unknown;
  role?: unknown;
};

type MembershipRow = {
  role: "owner" | "member";
};

const roleValues = new Set(["owner", "member"]);

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return NextResponse.json(
      { error: "Supabase設定が見つかりません。" },
      { status: 500 }
    );
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as InviteRequest | null;
  const organizationId = getString(payload?.organizationId);
  const email = getString(payload?.email).toLowerCase();
  const displayName = getString(payload?.displayName);
  const password = getString(payload?.password);
  const role = getString(payload?.role);

  if (!organizationId || !email || !displayName || !password || !roleValues.has(role)) {
    return NextResponse.json({ error: "招待内容が不正です。" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "パスワードは6文字以上にしてください。" }, { status: 400 });
  }

  const userScopedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
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
  } = await userScopedSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const { data: membershipData, error: membershipError } = await userScopedSupabase
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  if (membershipError || (membershipData as MembershipRow | null)?.role !== "owner") {
    return NextResponse.json({ error: "管理者権限が必要です。" }, { status: 403 });
  }

  const serviceSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data: createdUser, error: createUserError } =
    await serviceSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName
      }
    });

  if (createUserError || !createdUser.user) {
    return NextResponse.json(
      { error: createUserError?.message ?? "ユーザーを作成できませんでした。" },
      { status: 400 }
    );
  }

  const token = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: profileError } = await serviceSupabase.from("profiles").upsert(
    {
      id: createdUser.user.id,
      display_name: displayName,
      email
    },
    { onConflict: "id" }
  );

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: invitationError } = await serviceSupabase.from("invitations").insert({
    organization_id: organizationId,
    email,
    display_name: displayName,
    role,
    token,
    created_by: user.id,
    invited_user_id: createdUser.user.id,
    expires_at: expiresAt
  });

  if (invitationError) {
    return NextResponse.json({ error: invitationError.message }, { status: 500 });
  }

  return NextResponse.json({
    token,
    expiresAt
  });
}
