import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { reportQueries, segmentQueries } from "@/lib/db/queries";
import type { ReportType } from "@/lib/db/schema";
import { generateReportContent } from "@/lib/ai/report";

/**
 * POST /api/reports/generate —— 独立生成报告（不经过 agent，不产生对话消息）
 * body: { type: "weekly"|"monthly"|"stage", periodStart, periodEnd, segmentId? }
 * 返回 { report } —— 已持久化的报告（含 metrics 与 plan）
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as {
    type: string;
    periodStart: string;
    periodEnd: string;
    segmentId?: string;
  };

  // 校验 type
  if (
    body.type !== "weekly" &&
    body.type !== "monthly" &&
    body.type !== "stage"
  ) {
    return NextResponse.json(
      { error: "type 必须为 weekly / monthly / stage" },
      { status: 400 },
    );
  }
  const type = body.type as ReportType;

  if (!body.periodStart || !body.periodEnd) {
    return NextResponse.json(
      { error: "periodStart 与 periodEnd 必填" },
      { status: 400 },
    );
  }
  if (body.periodStart > body.periodEnd) {
    return NextResponse.json(
      { error: "periodStart 必须早于或等于 periodEnd" },
      { status: 400 },
    );
  }

  // 阶段报必须带 segmentId 并校验归属
  let segmentName: string | undefined;
  if (type === "stage") {
    if (!body.segmentId) {
      return NextResponse.json(
        { error: "阶段报必须提供 segmentId" },
        { status: 400 },
      );
    }
    const seg = await segmentQueries.findById(user.id, body.segmentId);
    if (!seg) {
      return NextResponse.json(
        { error: "任务段不存在或不属于当前用户" },
        { status: 404 },
      );
    }
    segmentName = seg.name;
  }

  // 同周期去重：同 type + 同 periodEnd 视为已生成
  const exists = await reportQueries.hasForPeriod(
    user.id,
    type,
    body.periodEnd,
  );
  if (exists) {
    return NextResponse.json(
      { error: "该周期已生成过报告" },
      { status: 409 },
    );
  }

  // 调用独立生成器（streamText + 结构化输出）
  const generated = await generateReportContent({
    userId: user.id,
    type,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    segmentId: body.segmentId,
    segmentName,
  });

  // 持久化：createReport 内部会重新加载任务并计算 metrics（权威来源）
  const report = await reportQueries.create(user.id, {
    type,
    title: generated.title,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    segmentId: body.segmentId,
    summary: generated.summary,
    plan: generated.planTasks,
  });

  return NextResponse.json({ report });
}
