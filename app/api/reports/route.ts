import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { reportQueries, taskQueries } from "@/lib/db/queries";

/** GET /api/reports —— 返回当前登录用户的全部报告（按创建时间倒序） */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const reports = await reportQueries.load(user.id);
  return NextResponse.json({ reports });
}

/** POST /api/reports —— 应用某报告的下周期规划，批量创建任务
 *  body: { reportId } 返回创建的任务与最新 tasksByDate */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { reportId } = (await req.json()) as { reportId: string };
  const created = await reportQueries.applyPlan(user.id, reportId);
  const tasksByDate = await taskQueries.loadByDate(user.id);
  return NextResponse.json({ created, tasksByDate });
}
