import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  loadDueReminders,
  markRemindersNotified,
} from "@/lib/db/queries";

/**
 * 供 Service Worker 轮询的提醒检查端点（同源请求携带 session cookie 鉴权）。
 * 返回所有已到点但尚未通知的提醒任务，并立即标记为已通知以避免重复触发。
 * SW 收到后逐一调用 registration.showNotification 推送浏览器通知。
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const due = await loadDueReminders(user.id);
  if (due.length > 0) {
    await markRemindersNotified(
      user.id,
      due.map((d) => d.id),
    );
  }
  return NextResponse.json({ due });
}
