import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getUserPreferences,
  updateUserPreferences,
  mergePreferences,
} from "@/lib/db/queries";
import type { PreferencesPatch } from "@/lib/db/schema";

/** 读取当前用户偏好 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const preferences = await getUserPreferences(user.id);
  return NextResponse.json({ preferences });
}

/** 部分更新用户偏好（deep merge，skills 数组整体替换） */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json()) as { patch?: PreferencesPatch };
  if (!body.patch) {
    return new Response("Missing patch", { status: 400 });
  }
  const current = await getUserPreferences(user.id);
  const merged = mergePreferences(current, body.patch);
  const preferences = await updateUserPreferences(user.id, merged);
  return NextResponse.json({ preferences });
}
