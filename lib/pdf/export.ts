import { put } from "@vercel/blob";
import { segmentQueries, taskQueries } from "@/lib/db/queries";
import { renderTaskPdf } from "./document";

export interface ExportInput {
  startDate: string;
  endDate: string;
  segmentId?: string;
}

export interface ExportResult {
  /** Vercel Blob 中的 pathname，客户端通过 /api/export?path=... 下载 */
  pathname: string;
  filename: string;
  count: number;
  startDate: string;
  endDate: string;
  segmentName?: string;
  /** 展示标题（任务段名称或「startDate ~ endDate」） */
  title: string;
}

/**
 * 解析后的导出条目（从 Blob list 的 pathname 中解析得到）。
 * 由于不使用数据库表，所有元数据都编码在 pathname 中。
 */
export interface ExportEntry {
  pathname: string;
  filename: string;
  title: string;
  startDate: string;
  endDate: string;
  count: number;
  /** 上传时间（Blob 的 uploadedAt，ISO 字符串） */
  createdAt: string;
  /** 文件大小（字节） */
  size: number;
}

/** pathname 字段分隔符（用双下划线避免与单下划线冲突） */
const SEP = "__";

/**
 * 构造导出文件的 Blob pathname。
 *
 * 格式：`export/<userId>/<timestamp>__<startDate>__<endDate>__<count>__<safeTitle>.pdf`
 * - timestamp：上传时刻的毫秒数，用于排序与跨用户隔离
 * - startDate / endDate / count：解析时还原到列表展示
 * - safeTitle：title 中的 `__` 替换为 `_`，避免与分隔符冲突
 *
 * 客户端无法直接访问私有 Blob，需经 /api/export 鉴权中转下载。
 */
function buildExportPathname(
  userId: string,
  title: string,
  startDate: string,
  endDate: string,
  count: number,
): string {
  const ts = Date.now();
  const safeTitle = title.replace(/__/g, "_");
  return `export/${userId}/${ts}${SEP}${startDate}${SEP}${endDate}${SEP}${count}${SEP}${safeTitle}.pdf`;
}

/**
 * 从 Blob pathname 解析导出元数据。
 * 解析失败时返回 null（调用方应跳过此类文件，可能是旧格式或其他来源）。
 */
export function parseExportPathname(
  pathname: string,
  uploadedAt: Date,
  size: number,
): ExportEntry | null {
  // 校验路径前缀与扩展名
  if (!pathname.startsWith("export/") || !pathname.endsWith(".pdf")) {
    return null;
  }
  const name = pathname.slice("export/".length).split("/").pop();
  if (!name) return null;
  const stem = name.replace(/\.pdf$/, "");
  const parts = stem.split(SEP);
  if (parts.length < 5) return null;
  const [tsStr, startDate, endDate, countStr, ...titleParts] = parts;
  const ts = Number(tsStr);
  const count = Number(countStr);
  if (!ts || !startDate || !endDate || Number.isNaN(count)) return null;
  const title = titleParts.join(SEP) || `${startDate} ~ ${endDate}`;
  return {
    pathname,
    filename: `${title}.pdf`,
    title,
    startDate,
    endDate,
    count,
    createdAt: uploadedAt.toISOString(),
    size,
  };
}

/**
 * 导出任务为 PDF 并上传到 Vercel Blob（私有访问），返回 pathname 供客户端下载。
 *
 * 流程：加载时间段任务 → 查任务段名称 → 渲染 PDF → 上传私有 Blob → 返回。
 * 元数据（title / startDate / endDate / count）编码在 pathname 中，供后续 list 解析。
 * 客户端不能直接访问私有 Blob URL，必须通过 /api/export 路由鉴权后中转下载。
 * 需要 BLOB_READ_WRITE_TOKEN 环境变量，否则 put 会抛错。
 */
export async function exportTasksToPdf(
  userId: string,
  input: ExportInput,
): Promise<ExportResult> {
  const { startDate, endDate, segmentId } = input;

  console.log("Loading tasks ...")
  const tasks = await taskQueries.loadInRange(userId, startDate, endDate);

  let segmentName: string | undefined;
  if (segmentId) {
    const seg = await segmentQueries.findById(userId, segmentId);
    segmentName = seg?.name;
  }

  const pdfBuffer = await renderTaskPdf({
    tasks,
    startDate,
    endDate,
    segmentName,
  });

  const title = segmentName ?? `${startDate} ~ ${endDate}`;
  const blobPath = buildExportPathname(
    userId,
    title,
    startDate,
    endDate,
    tasks.length,
  );
  console.log("Uploading document ...")
  await put(blobPath, pdfBuffer, {
    access: "private",
    contentType: "application/pdf",
  });

  console.log("Completed")
  const prefix = segmentName ?? `${startDate}_${endDate}`;
  return {
    pathname: blobPath,
    filename: `${prefix}.pdf`,
    count: tasks.length,
    startDate,
    endDate,
    segmentName,
    title,
  };
}
