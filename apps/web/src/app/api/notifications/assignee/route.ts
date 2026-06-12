import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import webpush, { type PushSubscription } from "web-push";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publicVapidKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";
const privateVapidKey = process.env.WEB_PUSH_PRIVATE_KEY ?? "";
const vapidSubject =
  process.env.WEB_PUSH_SUBJECT ?? process.env.NEXT_PUBLIC_APP_URL ?? supabaseUrl;

export const runtime = "nodejs";

type NotificationRequest = {
  reportId?: unknown;
  addedAssigneeIds?: unknown;
};

type ReportRow = {
  id: string;
  description: string;
  assignee_ids: string[] | null;
};

type PushSubscriptionRow = {
  endpoint: string;
  subscription: PushSubscription;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function getWebPushStatusCode(reason: unknown) {
  return typeof reason === "object" && reason !== null && "statusCode" in reason
    ? (reason as { statusCode?: number }).statusCode
    : undefined;
}

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Supabase設定が見つかりません。" },
      { status: 500 }
    );
  }

  if (!supabaseServiceRoleKey || !publicVapidKey || !privateVapidKey || !vapidSubject) {
    return NextResponse.json(
      { error: "プッシュ通知設定が見つかりません。" },
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
    .select("id, description, assignee_ids")
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

  const adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data: subscriptionsData, error: subscriptionsError } = await adminSupabase
    .from("web_push_subscriptions")
    .select("endpoint, subscription")
    .in("user_id", targetAssigneeIds);

  if (subscriptionsError) {
    return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
  }

  const subscriptions = (subscriptionsData ?? []) as PushSubscriptionRow[];

  if (!subscriptions.length) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const reportText = report.description || "コメントなし";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const pushPayload = JSON.stringify({
    title: "担当者に設定されました",
    body: reportText,
    url: appUrl ? `${appUrl}/?reportId=${report.id}` : `/?reportId=${report.id}`
  });

  webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);

  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(subscription.subscription, pushPayload)
    )
  );

  const expiredEndpoints = subscriptions
    .filter((subscription, index) => {
      const result = results[index];
      return (
        result?.status === "rejected" &&
        [404, 410].includes(getWebPushStatusCode(result.reason) ?? 0)
      );
    })
    .map((subscription) => subscription.endpoint);

  if (expiredEndpoints.length) {
    await adminSupabase
      .from("web_push_subscriptions")
      .delete()
      .in("endpoint", expiredEndpoints);
  }

  const hasFailure = results.some(
    (result) =>
      result.status === "rejected" &&
      ![404, 410].includes(getWebPushStatusCode(result.reason) ?? 0)
  );

  if (hasFailure) {
    return NextResponse.json(
      { error: "プッシュ通知を送信できませんでした。" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
