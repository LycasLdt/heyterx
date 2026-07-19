import { Font } from "@react-pdf/renderer";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 中文字体注册：react-pdf 默认不内置中文字体，必须注册一个支持中文的字体，
 * 否则 PDF 中的中文会显示为空白方块。
 *
 * react-pdf v4 的 Font.register 只接受 `src: string`（URL），不支持 data 字段，
 * 故本地字体文件转 base64 data URL 作为 src，CDN fallback 直接用远程 URL。
 *
 * 加载顺序：
 * 1. 本地 public/fonts/NotoSansSC-Regular.ttf → 转 base64 data URL（离线可用、快）
 * 2. CDN fallback（jsdelivr 上的 Noto Sans CJK SC OTF，约 16MB，首次较慢）
 *
 * 用模块级 promise 缓存，整个进程只注册一次；react-pdf 内部也会缓存已加载的 src。
 */

export const FONT_FAMILY = "NotoSansSC";

const LOCAL_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "NotoSansSC-Regular.otf",
);

// Noto Sans CJK SC（思源黑体简体中文）OTF，完整覆盖中文
const CDN_URL =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";

let registering: Promise<void> | null = null;

/**
 * 确保中文字体已注册。多次调用安全（幂等）。
 * 必须在 renderToBuffer 之前 await。
 */
export function ensureChineseFont(): Promise<void> {
  if (registering) return registering;
  registering = (async () => {
    let src: string;
    try {
      // 优先本地字体文件 → base64 data URL
      const buf = await fs.readFile(LOCAL_PATH);
      const mime = LOCAL_PATH.endsWith(".otf") ? "font/otf" : "font/ttf";
      src = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      // 本地不存在 → 用 CDN URL（react-pdf 内部 fetch 加载）
      src = CDN_URL;
    }
    Font.register({
      family: FONT_FAMILY,
      src,
    });
    // 中文不断词：react-pdf 默认按英文规则 hyphenate，会把中文当作长单词处理
    // 返回 [word] 表示整词不分段，保持中文连续显示
    Font.registerHyphenationCallback((word: string) => [word]);
  })();
  return registering;
}

