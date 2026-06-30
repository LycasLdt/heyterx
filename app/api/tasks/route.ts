import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadSegments, loadTasksByDate, setTaskDone } from "@/lib/db/queries";
import { formatDate } from "@/lib/date";

/** GET /api/tasks —— 返回当前登录用户的全部任务（按日期分组）与全部任务段 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const [tasksByDate, segments] = await Promise.all([
    loadTasksByDate(user.id),
    loadSegments(user.id),
  ]);
  return NextResponse.json({
    tasksByDate,
    segments,
    today: formatDate(new Date()),
  });
}

/** PATCH /api/tasks —— 客户端勾选/取消勾选任务时同步到数据库
 *  body: { id, done } 仅修改指定 id 的任务完成状态 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id, done } = (await req.json()) as { id: string; done: boolean };

  const task = await setTaskDone(user.id, id, done);
  if (!task) {
    return new Response("Task not found", { status: 404 });
  }
  const tasksByDate = await loadTasksByDate(user.id);
  return NextResponse.json({ task, tasksByDate });
}
