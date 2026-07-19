"use client";

import { memo, useEffect, useState, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { marked } from "marked";
import remarkGfm from "remark-gfm";
import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type BuiltinLanguage,
  type Highlighter,
} from "shiki";

// 使用 JS 正则引擎（无需加载 WASM，浏览器端更可靠），按需懒加载语言
let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      engine: createJavaScriptRegexEngine(),
      themes: ["github-dark"],
      langs: [],
    });
  }
  return highlighterPromise;
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false;
    return true;
  },
);

/**
 * 用 react-markdown 渲染 Markdown（remark-gfm 启用表格 / 删除线 / 任务列表 / 自动链接），
 * 代码块用 shiki 做语法高亮。
 * 流式阶段由调用方显示纯文本，等流结束后再进入这里渲染——避免逐 token 重新高亮。
 */
export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

  return (
    <div className="text-sm leading-relaxed [&_>*:first-child]:mt-0 [&_>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-primary [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_hr]:my-3 [&_hr]:border-t [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_img]:max-w-full [&_table]:my-2 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1">
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock content={block} key={`block_${index}`} />
      ))}
    </div>
  );
});

const components: Components = {
  pre: ({ node }) => {
    // 从 hast 节点中取 code 文本与语言，交给 shiki 高亮
    const codeNode = node?.children?.find(
      (
        c,
      ): c is (typeof node.children)[number] & {
        type: "element";
        tagName: "code";
      } => c.type === "element" && c.tagName === "code",
    );
    if (codeNode) {
      const className =
        (codeNode.properties?.className as string[] | undefined) ?? [];
      const langClass = className.find((c) => c.startsWith("language-"));
      const lang = langClass ? langClass.replace("language-", "") : "text";
      const code = codeNode.children
        .map((c) => ("value" in c ? (c.value as string) : ""))
        .join("")
        .replace(/\n$/, "");
      return <CodeBlock code={code} lang={lang} />;
    }
    return <pre />;
  },
  code: ({ className, children, ...props }) => (
    <code
      className="rounded bg-foreground/10 px-1 py-0.5 text-[0.85em]"
      {...props}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, ...props }) => (
    <a target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  ),
};

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const targetLang = (lang || "text") as BuiltinLanguage;
    getHighlighter()
      .then(async (hl) => {
        if (!hl.getLoadedLanguages().includes(targetLang)) {
          try {
            await hl.loadLanguage(targetLang);
          } catch {
            // 未知语言，回退为纯文本
            return null;
          }
        }
        return hl.codeToHtml(code, { lang: targetLang, theme: "github-dark" });
      })
      .then((out) => {
        if (active && out) setHtml(out);
      })
      .catch(() => {
        if (active) setHtml(null);
      });
    return () => {
      active = false;
    };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className="my-2 overflow-x-auto rounded-lg text-xs [&>pre]:m-0! [&>pre]:p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  // shiki 加载中或失败时回退为纯文本
  return (
    <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs leading-relaxed">
      <code>{code}</code>
    </pre>
  );
}
