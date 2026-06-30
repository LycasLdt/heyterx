import { put, del, head } from "@vercel/blob";

/**
 * 核心记忆（Core Memory）—— 用户偏好 / 性格 / 目标 / 身份等
 * 以 markdown 文件存储在 Vercel Blob Store，每个用户一个文件：memory/<userId>.md
 * better-auth 不管理此字段，由应用层（Agent 工具）直接读写。
 */

const PREFIX = "memory/";

function pathname(userId: string): string {
  return `${PREFIX}${userId}.md`;
}

/** 读取用户核心记忆 markdown。文件不存在或读取失败时返回空字符串。 */
export async function readCoreMemory(userId: string): Promise<string> {
  const metadata = await head(pathname(userId));
  const content = await (
    await fetch(metadata.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    })
  ).text();
  return content;
}

/** 写入（覆盖）用户核心记忆 markdown。 */
export async function writeCoreMemory(
  userId: string,
  content: string,
): Promise<void> {
  await put(pathname(userId), content, {
    access: "private",
    contentType: "text/markdown",
  });
}

/** 删除用户核心记忆 markdown（账号注销时调用）。 */
export async function deleteCoreMemory(userId: string): Promise<void> {
  try {
    await del(pathname(userId));
  } catch {}
}
