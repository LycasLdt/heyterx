import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { userQueries } from "@/lib/db/queries";

/** 删除当前用户账号（cascade 会清除 session/account/task/conversation/report） */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  await userQueries.delete(user.id);
  return NextResponse.json({ ok: true });
}
