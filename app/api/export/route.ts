import { copy, del, head, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  exportTasksToPdf,
  parseExportPathname,
  type ExportEntry,
} from "@/lib/pdf/export";

/**
 * /api/export —— PDF 导出文件的中转与管理端点。
 *
 * 不使用数据库表存储导出记录，所有元数据编码在 Blob pathname 中
 * （格式见 lib/pdf/export.ts 的 buildExportPathname），通过 Vercel Blob list
 * 直接读取导出列表。
 *
 * 安全：所有方法都要求登录；path 参数必须形如 `export/<当前用户 id>/...`，
 * 且以 .pdf 结尾，防止跨用户访问或路径穿越。
 *
 * 方法：
 * - GET    ?path=&filename=    中转下载指定 PDF（私有 Blob 鉴权后回传二进制）
 * - GET    ?list=1             返回当前用户的全部导出列表（按上传时间倒序）
 * - POST   { startDate, endDate, segmentId? }  新增一次导出，返回新条目
 * - DELETE ?path=              删除指定 PDF（Blob del）
 * - PATCH  ?path= { title }    重命名（copy 到新 pathname + del 旧的）
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const isList = url.searchParams.get("list") === "1";

  // 列表模式：list(prefix=export/<userId>/) → 解析 pathname → 倒序
  if (isList) {
    const prefix = `export/${user.id}/`;
    const result = await list({ prefix, limit: 1000 });
    const entries: ExportEntry[] = [];
    for (const blob of result.blobs) {
      const entry = parseExportPathname(
        blob.pathname,
        blob.uploadedAt,
        blob.size,
      );
      if (entry) entries.push(entry);
    }
    // 按上传时间倒序（最新在前）
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ exports: entries });
  }

  // 下载模式：中转私有 Blob
  const path = url.searchParams.get("path");
  const filename = url.searchParams.get("filename") ?? "export.pdf";

  if (!path) {
    return new Response("Missing path", { status: 400 });
  }

  // 安全校验：path 必须以 export/<当前用户 id>/ 开头，且以 .pdf 结尾
  const prefix = `export/${user.id}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".pdf")) {
    return new Response("Forbidden", { status: 403 });
  }

  // 防止 path 中包含 .. 等目录穿越字符
  if (path.includes("..") || path.includes("//")) {
    return new Response("Invalid path", { status: 400 });
  }

  let metadata;
  try {
    metadata = await head(path);
  } catch {
    return new Response("File not found", { status: 404 });
  }

  // 私有 Blob 需带 BLOB_READ_WRITE_TOKEN 才能下载
  const blobRes = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
    },
  });

  if (!blobRes.ok || !blobRes.body) {
    return new Response("Failed to fetch blob", { status: 502 });
  }

  // 安全文件名（去除控制字符与路径分隔符）
  const safeFilename = filename.replace(/[\r\n"/\\]/g, "_");
  // Content-Disposition 的 filename="..." 仅支持 ASCII（ByteString），
  // 中文等非 ASCII 字符会触发 TypeError: Cannot convert argument to a ByteString。
  // 改用 RFC 5987 的 filename*=UTF-8''<percent-encoded> 形式，浏览器会自动解码。
  const encodedFilename = encodeURIComponent(safeFilename);
  return new Response(blobRes.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="export.pdf"; filename*=UTF-8''${encodedFilename}`,
      "Content-Length": String(metadata.size ?? 0),
      "Cache-Control": "private, no-store",
    },
  });
}

/** POST /api/export —— 手动新增一次导出
 *  body: { startDate, endDate, segmentId? }
 *  流程与 agent 的 exportTasks 工具一致：渲染 PDF → 上传私有 Blob → 返回新条目。 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { startDate, endDate, segmentId } = (await req.json()) as {
    startDate: string;
    endDate: string;
    segmentId?: string;
  };

  if (!startDate || !endDate) {
    return new Response("Missing startDate or endDate", { status: 400 });
  }
  if (startDate > endDate) {
    return new Response("startDate must be <= endDate", { status: 400 });
  }

  try {
    const result = await exportTasksToPdf(user.id, {
      startDate,
      endDate,
      segmentId,
    });
    return NextResponse.json({ export: result });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "导出 PDF 失败（可能 Blob 存储未配置）";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/export?path=... —— 删除指定导出的 PDF 文件 */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return new Response("Missing path", { status: 400 });
  }

  const prefix = `export/${user.id}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".pdf")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (path.includes("..") || path.includes("//")) {
    return new Response("Invalid path", { status: 400 });
  }

  try {
    await del(path);
  } catch {
    // Blob 删除失败（如文件已不存在）不阻塞，返回 200
  }
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/export?path=... —— 重命名导出（修改 title）
 * body: { title }
 *
 * 由于 Vercel Blob 不支持原地重命名，且 title 编码在 pathname 中，
 * 重命名 = copy 旧文件到新 pathname + del 旧文件。PDF 内容保持不变。
 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return new Response("Missing path", { status: 400 });
  }

  const prefix = `export/${user.id}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".pdf")) {
    return new Response("Forbidden", { status: 403 });
  }
  if (path.includes("..") || path.includes("//")) {
    return new Response("Invalid path", { status: 400 });
  }

  const { title } = (await req.json()) as { title?: string };
  if (!title || !title.trim()) {
    return new Response("Missing title", { status: 400 });
  }

  // 解析旧 pathname 取出 startDate / endDate / count，用新 title 构造新 pathname
  const oldEntry = parseExportPathname(path, new Date(), 0);
  if (!oldEntry) {
    return new Response("Invalid export pathname", { status: 400 });
  }

  const SEP = "__";
  const safeTitle = title.trim().replace(/__/g, "_");
  const newPath = `export/${user.id}/${Date.now()}${SEP}${oldEntry.startDate}${SEP}${oldEntry.endDate}${SEP}${oldEntry.count}${SEP}${safeTitle}.pdf`;

  try {
    await copy(path, newPath, {
      access: "private",
      contentType: "application/pdf",
    });
  } catch {
    return new Response("Failed to copy blob", { status: 502 });
  }

  try {
    await del(path);
  } catch {
    // 旧文件删除失败不阻塞重命名流程（已成功 copy）
  }

  return NextResponse.json({
    export: {
      pathname: newPath,
      filename: `${title.trim()}.pdf`,
      title: title.trim(),
      startDate: oldEntry.startDate,
      endDate: oldEntry.endDate,
      count: oldEntry.count,
      createdAt: new Date().toISOString(),
      size: oldEntry.size,
    },
  });
}
