import { NextResponse } from "next/server";
import type { UIMessage } from "ai";
import { getSessionUser } from "@/lib/auth";
import {
  clearConversations,
  getLatestConversation,
  saveConversation,
} from "@/lib/db/queries";

/** GET /api/conversations —— 返回用户最近一次对话的 messages，没有则返回 null */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const conversation = await getLatestConversation(user.id);
  return NextResponse.json({ conversation });
}

/** POST /api/conversations —— 保存（upsert）用户对话的 messages
 *  body: { id?, messages } —— 有 id 则更新该对话，没有则插入新对话 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id, messages } = (await req.json()) as {
    id?: string;
    messages: UIMessage[];
  };

  const savedId = await saveConversation(user.id, { id, messages });
  return NextResponse.json({ id: savedId });
}

/** DELETE /api/conversations —— 清空用户所有对话记录 */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  await clearConversations(user.id);
  return NextResponse.json({ ok: true });
}
