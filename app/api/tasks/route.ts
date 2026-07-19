import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadTasksInRange, segmentQueries, taskQueries } from "@/lib/db/queries";
import { formatDate } from "@/lib/utils/date";
import type { Category, Importance } from "@/lib/db/queries";

/** GET /api/tasks —— 返回当前登录用户的任务（按日期分组）与全部任务段
 *  - 无查询参数：返回全部任务（向后兼容，用于流式结束后 revalidate 安全网）
 *  - ?start=YYYY-MM-DD&end=YYYY-MM-DD：仅返回该日期范围内的任务（按需加载） */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const segments = await segmentQueries.load(user.id);
  if (start && end) {
    const rows = await loadTasksInRange(user.id, start, end);
    const tasksByDate: Record<string, typeof rows> = {};
    for (const r of rows) {
      const list = tasksByDate[r.date] ?? (tasksByDate[r.date] = []);
      list.push(r);
    }
    return NextResponse.json({
      tasksByDate,
      segments,
      today: formatDate(new Date()),
    });
  }
  const tasksByDate = await taskQueries.loadByDate(user.id);
  return NextResponse.json({
    tasksByDate,
    segments,
    today: formatDate(new Date()),
  });
}

/** PATCH /api/tasks —— 客户端修改任务
 *  body: { id, done?, title?, importance?, category?, tags?, reminderAt?, date? }
 *  - done：切换完成状态
 *  - title/importance/category/tags/reminderAt：修改任务字段
 *  - date：移动任务到指定日期（不可移到过去日期） */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = (await req.json()) as {
    id: string;
    done?: boolean;
    title?: string;
    importance?: Importance;
    category?: Category;
    tags?: string[];
    reminderAt?: string | null;
    date?: string;
  };

  // 日期移动：不可移到过去日期
  if (body.date) {
    const today = formatDate(new Date());
    if (body.date < today) {
      return new Response("Cannot move task to a past date", { status: 400 });
    }
    const task = await taskQueries.setDate(user.id, body.id, body.date);
    if (!task) return new Response("Task not found", { status: 404 });
    return NextResponse.json({ task });
  }

  // 完成状态切换
  if (body.done !== undefined) {
    const task = await taskQueries.setDone(user.id, body.id, body.done);
    if (!task) return new Response("Task not found", { status: 404 });
    return NextResponse.json({ task });
  }

  // 字段更新（title/importance/category/tags/reminderAt）
  const fieldInput: Parameters<typeof taskQueries.updateFields>[2] = {};
  if (body.title !== undefined) fieldInput.title = body.title;
  if (body.importance !== undefined) fieldInput.importance = body.importance;
  if (body.category !== undefined) fieldInput.category = body.category;
  if (body.tags !== undefined) fieldInput.tags = body.tags;
  if (body.reminderAt !== undefined)
    fieldInput.reminderAt = body.reminderAt;

  if (Object.keys(fieldInput).length === 0) {
    return new Response("No fields to update", { status: 400 });
  }
  const task = await taskQueries.updateFields(user.id, body.id, fieldInput);
  if (!task) return new Response("Task not found", { status: 404 });
  return NextResponse.json({ task });
}

/** DELETE /api/tasks —— 删除任务
 *  body: { id } */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = (await req.json()) as { id: string };
  const task = await taskQueries.remove(user.id, id);
  if (!task) return new Response("Task not found", { status: 404 });
  return NextResponse.json({ task });
}
