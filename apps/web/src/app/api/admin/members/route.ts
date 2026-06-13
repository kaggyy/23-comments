import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type UpdateMemberRequest = {
  organizationId?: unknown;
  memberId?: unknown;
  displayName?: unknown;
  email?: unknown;
  loginId?: unknown;
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

export async function PATCH(request: Request) {
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

  const payload = (await request.json().catch(() => null)) as UpdateMemberRequest | null;
  const organizationId = getString(payload?.organizationId);
  const memberId = getString(payload?.memberId);
  const displayName = getString(payload?.displayName);
  const email = getString(payload?.email).toLowerCase();
  const loginId = getString(payload?.loginId);
  const password = getString(payload?.password);
  const role = getString(payload?.role);

  if (
    !organizationId ||
    !memberId ||
    !displayName ||
    !email ||
    !loginId ||
    !roleValues.has(role)
  ) {
    return NextResponse.json({ error: "メンバー情報が不正です。" }, { status: 400 });
  }

  if (password && password.length < 6) {
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

  const { data: targetMembership, error: targetMembershipError } = await serviceSupabase
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", memberId)
    .single();

  if (targetMembershipError || !targetMembership) {
    return NextResponse.json({ error: "メンバーが見つかりません。" }, { status: 404 });
  }

  const authUpdate = {
    email,
    email_confirm: true,
    user_metadata: {
      display_name: displayName
    }
  } as {
    email: string;
    email_confirm: boolean;
    password?: string;
    user_metadata: {
      display_name: string;
    };
  };

  if (password) {
    authUpdate.password = password;
  }

  const { error: authError } = await serviceSupabase.auth.admin.updateUserById(memberId, authUpdate);

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { error: profileError } = await serviceSupabase.from("profiles").upsert(
    {
      id: memberId,
      display_name: displayName,
      email,
      login_id: loginId,
      login_password: password
    },
    { onConflict: "id" }
  );

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: roleError } = await serviceSupabase
    .from("memberships")
    .update({ role })
    .eq("organization_id", organizationId)
    .eq("user_id", memberId);

  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 500 });
  }

  return NextResponse.json({
    member: {
      id: memberId,
      display_name: displayName,
      email,
      login_id: loginId,
      login_password: password,
      role
    }
  });
}
