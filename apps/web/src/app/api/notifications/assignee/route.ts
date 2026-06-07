import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const resendApiKey = process.env.RESEND_API_KEY ?? "";
const notificationFrom = process.env.NOTIFICATION_FROM ?? "";

type NotificationRequest = {
  reportId?: unknown;
  addedAssigneeIds?: unknown;
};

type ReportRow = {
  id: string;
  description: string;
  page_url: string;
  assignee_ids: string[] | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Supabase設定が見つかりません。" },
      { status: 500 }
    );
  }

  if (!resendApiKey || !notificationFrom) {
    return NextResponse.json(
      { error: "メール通知設定が見つかりません。" },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as NotificationRequest | null;
  const reportId = payload?.reportId;
  const addedAssigneeIds = payload?.addedAssigneeIds;

  if (!isUuid(reportId) || !Array.isArray(addedAssigneeIds)) {
    return NextResponse.json({ error: "通知内容が不正です。" }, { status: 400 });
  }

  const requestedAssigneeIds = Array.from(
    new Set(addedAssigneeIds.filter(isUuid))
  );

  if (!requestedAssigneeIds.length) {
    return NextResponse.json({ ok: true, skipped: true });
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

  const { data: reportData, error: reportError } = await supabase
    .from("reports")
    .select("id, description, page_url, assignee_ids")
    .eq("id", reportId)
    .single();

  if (reportError || !reportData) {
    return NextResponse.json({ error: "通知対象が見つかりません。" }, { status: 404 });
  }

  const report = reportData as ReportRow;
  const currentAssigneeIds = new Set(report.assignee_ids ?? []);
  const targetAssigneeIds = requestedAssigneeIds.filter((assigneeId) =>
    currentAssigneeIds.has(assigneeId)
  );

  if (!targetAssigneeIds.length) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", targetAssigneeIds);

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const recipientEmails = ((profilesData ?? []) as ProfileRow[])
    .map((profile) => profile.email)
    .filter((email): email is string => Boolean(email));

  if (!recipientEmails.length) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const reportText = report.description || "コメントなし";
  const text = [
    "担当者に設定されました。",
    "",
    reportText,
    report.page_url
  ].join("\n");

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: notificationFrom,
      to: recipientEmails,
      subject: "担当者に設定されました",
      text
    })
  });

  if (!resendResponse.ok) {
    return NextResponse.json(
      { error: "メール通知を送信できませんでした。" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
