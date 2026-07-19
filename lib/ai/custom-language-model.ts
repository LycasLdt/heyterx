import {
  type APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4FunctionTool,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4Prompt,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  convertToBase64,
  createEventSourceResponseHandler,
  createIdGenerator,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getErrorMessage,
  postJsonToApi,
  withoutTrailingSlash,
  type FetchFunction,
  type ParseResult,
} from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { ModelApiFormat, ModelConfig } from "@/lib/db/schema";

/**
 * 自定义 Language Model provider。
 *
 * 同时支持两种 API 格式：
 * - "openai"：标准 /v1/chat/completions（兼容 OpenAI / DeepSeek / Kimi / 智谱 GLM 等）
 * - "claude"：Anthropic /v1/messages
 *
 * 多模态：user 消息中的 file part 会被转换成对应格式
 * - OpenAI 图片 → image_url，音频 → input_audio，视频 → 降级为 url 文本
 * - Claude 图片 → image source(base64/url)，音频/视频 → document source
 */

export interface CustomLanguageModelOptions {
  config: ModelConfig;
  fetch?: FetchFunction;
  generateIdFn?: () => string;
}

const DEFAULT_MAX_TOKENS = 4096;

// ---------- 错误 schema ----------
const openAIErrorSchema = z.object({
  error: z
    .object({
      message: z.string(),
      type: z.string().nullish(),
      code: z.union([z.string(), z.number()]).nullish(),
    })
    .nullish(),
});

const anthropicErrorSchema = z.object({
  type: z.string().nullish(),
  error: z
    .object({
      type: z.string().nullish(),
      message: z.string().nullish(),
    })
    .nullish(),
});

// ---------- OpenAI 响应 schema ----------
const openAIChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z
        .object({
          role: z.string().nullish(),
          content: z.string().nullish(),
          // DeepSeek-R1 / GLM-Z1 / Qwen3-thinking 等推理模型的思维链内容
          reasoning_content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.string().nullish(),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .nullish(),
        })
        .nullish(),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
      // DeepSeek-V4 等模型的缓存命中/未命中 token 数
      prompt_cache_hit_tokens: z.number().nullish(),
      prompt_cache_miss_tokens: z.number().nullish(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

const openAIChatChunkSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      delta: z
        .object({
          role: z.string().nullish(),
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                index: z.number(),
                id: z.string().nullish(),
                type: z.string().nullish(),
                function: z
                  .object({
                    name: z.string().nullish(),
                    arguments: z.string().nullish(),
                  })
                  .nullish(),
              }),
            )
            .nullish(),
        })
        .nullish(),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
      prompt_cache_hit_tokens: z.number().nullish(),
      prompt_cache_miss_tokens: z.number().nullish(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

// ---------- Anthropic 响应 schema ----------
const anthropicResponseSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  role: z.string().nullish(),
  type: z.string().nullish(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().nullish(),
      id: z.string().nullish(),
      name: z.string().nullish(),
      input: z.unknown().nullish(),
    }),
  ),
  stop_reason: z.string().nullish(),
  usage: z
    .object({
      input_tokens: z.number().nullish(),
      output_tokens: z.number().nullish(),
    })
    .nullish(),
});

const anthropicStreamEventSchema = z.object({
  type: z.string(),
  message: z
    .object({
      id: z.string().nullish(),
      model: z.string().nullish(),
      usage: z
        .object({
          input_tokens: z.number().nullish(),
          output_tokens: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  index: z.number().nullish(),
  content_block: z
    .object({
      type: z.string().nullish(),
      text: z.string().nullish(),
      id: z.string().nullish(),
      name: z.string().nullish(),
      input: z.unknown().nullish(),
    })
    .nullish(),
  delta: z
    .object({
      type: z.string().nullish(),
      text: z.string().nullish(),
      partial_json: z.string().nullish(),
      stop_reason: z.string().nullish(),
    })
    .nullish(),
  usage: z
    .object({
      input_tokens: z.number().nullish(),
      output_tokens: z.number().nullish(),
    })
    .nullish(),
  error: z
    .object({
      type: z.string().nullish(),
      message: z.string().nullish(),
    })
    .nullish(),
});

// ---------- 工具函数 ----------

function toUnifiedFinishReason(
  raw?: string | null,
):
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other" {
  switch (raw) {
    case "stop":
    case "end_turn":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool-calls":
    case "tool_use":
      return "tool-calls";
    case "content-filter":
      return "content-filter";
    case "error":
      return "error";
    default:
      return "other";
  }
}

function isFunctionTool(
  tool: unknown,
): tool is LanguageModelV4FunctionTool {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "type" in tool &&
    (tool as { type: string }).type === "function"
  );
}

/** 从 file part 中提取 base64 数据（如果是 data 类型）；否则返回 undefined */
function getFileDataBase64(part: {
  data: { type: string; data?: unknown; url?: unknown; text?: unknown };
}): string | undefined {
  if (part.data.type === "data" && typeof part.data.data === "string") {
    return part.data.data;
  }
  if (
    part.data.type === "data" &&
    part.data.data instanceof Uint8Array
  ) {
    return convertToBase64(part.data.data);
  }
  if (
    part.data.type === "data" &&
    part.data.data instanceof ArrayBuffer
  ) {
    return convertToBase64(new Uint8Array(part.data.data));
  }
  return undefined;
}

/** 从 file part 中提取 url（如果是 url 类型）；否则返回 undefined */
function getFileUrl(part: {
  data: { type: string; url?: unknown };
}): string | undefined {
  return part.data.type === "url" && typeof part.data.url === "string"
    ? part.data.url
    : undefined;
}

/** 把 ai-sdk prompt 转成 OpenAI messages 数组（含多模态） */
function convertToOpenAIMessages(prompt: LanguageModelV4Prompt) {
  const messages: unknown[] = [];
  for (const msg of prompt) {
    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      const parts: unknown[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "file") {
          const mt = part.mediaType;
          const top = mt.split("/")[0];
          if (top === "image") {
            const url = getFileUrl(part) ?? getFileDataBase64(part);
            const finalUrl = url
              ? url.startsWith("http") || url.startsWith("data:")
                ? url
                : `data:${mt};base64,${url}`
              : "";
            parts.push({ type: "image_url", image_url: { url: finalUrl } });
          } else if (top === "audio") {
            const b64 = getFileDataBase64(part) ?? "";
            const format = mt.split("/")[1] ?? "wav";
            parts.push({
              type: "input_audio",
              input_audio: { data: b64, format },
            });
          } else {
            const url = getFileUrl(part) ?? getFileDataBase64(part);
            const finalUrl = url
              ? url.startsWith("http") || url.startsWith("data:")
                ? url
                : `data:${mt};base64,${url}`
              : "";
            parts.push({ type: "text", text: finalUrl });
          }
        }
      }
      messages.push({ role: "user", content: parts });
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: unknown[] = [];
      // 收集 reasoning 内容；工具调用后续轮次必须完整回传给 API，否则会 400
      let reasoning: string | undefined;
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "reasoning") {
          reasoning = reasoning == null ? part.text : reasoning + part.text;
        } else if (part.type === "tool-call") {
          toolCalls.push({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input),
            },
          });
        }
      }
      const message: Record<string, unknown> = { role: "assistant" };
      if (textParts.length > 0) message.content = textParts.join("");
      // 即使本轮 assistant 没有 text，但有 tool_calls 时也保留 content 字段为空串，
      // 避免部分 API 因 content 缺失报错；reasoning_content 有值才传
      if (textParts.length === 0 && toolCalls.length > 0) {
        message.content = "";
      }
      if (reasoning != null) message.reasoning_content = reasoning;
      if (toolCalls.length > 0) message.tool_calls = toolCalls;
      messages.push(message);
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const out = part.output;
          let content: string;
          if (out.type === "text" || out.type === "error-text") {
            content = out.value;
          } else if (out.type === "json" || out.type === "error-json") {
            content = JSON.stringify(out.value);
          } else if (out.type === "content") {
            content = out.value
              .map((c) => (c.type === "text" ? c.text : ""))
              .join("");
          } else {
            content = "";
          }
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content,
          });
        }
      }
    }
  }
  return messages;
}

/** 把 ai-sdk prompt 转成 Anthropic messages（system 抽出） */
function convertToAnthropicMessages(prompt: LanguageModelV4Prompt): {
  system: string | undefined;
  messages: unknown[];
} {
  const messages: unknown[] = [];
  let system: string | undefined;
  for (const msg of prompt) {
    if (msg.role === "system") {
      system = (system ?? "") + msg.content;
    } else if (msg.role === "user") {
      const parts: unknown[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "file") {
          const mt = part.mediaType;
          const top = mt.split("/")[0];
          if (top === "image") {
            const url = getFileUrl(part);
            if (url) {
              parts.push({
                type: "image",
                source: { type: "url", url },
              });
            } else {
              const b64 = getFileDataBase64(part) ?? "";
              parts.push({
                type: "image",
                source: { type: "base64", media_type: mt, data: b64 },
              });
            }
          } else {
            const url = getFileUrl(part);
            if (url) {
              parts.push({
                type: "document",
                source: { type: "url", url },
              });
            } else {
              const b64 = getFileDataBase64(part) ?? "";
              parts.push({
                type: "document",
                source: { type: "base64", media_type: mt, data: b64 },
              });
            }
          }
        }
      }
      messages.push({ role: "user", content: parts });
    } else if (msg.role === "assistant") {
      const parts: unknown[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "tool-call") {
          parts.push({
            type: "tool_use",
            id: part.toolCallId,
            name: part.toolName,
            input: part.input ?? {},
          });
        }
      }
      messages.push({ role: "assistant", content: parts });
    } else if (msg.role === "tool") {
      const parts: unknown[] = [];
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const out = part.output;
          let content: unknown;
          if (out.type === "text" || out.type === "error-text") {
            content = out.value;
          } else if (out.type === "json" || out.type === "error-json") {
            content = JSON.stringify(out.value);
          } else if (out.type === "content") {
            content = out.value.map((c) =>
              c.type === "text" ? { type: "text", text: c.text } : c,
            );
          } else {
            content = "";
          }
          parts.push({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content,
          });
        }
      }
      messages.push({ role: "user", content: parts });
    }
  }
  return { system, messages };
}

function toOpenAITools(
  tools?: LanguageModelV4CallOptions["tools"],
):
  | {
      type: "function";
      function: {
        name: string;
        description?: string;
        parameters: unknown;
      };
    }[]
  | undefined {
  if (!tools || tools.length === 0) return undefined;
  const mapped = tools
    .filter(isFunctionTool)
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  return mapped.length > 0 ? mapped : undefined;
}

function toAnthropicTools(
  tools?: LanguageModelV4CallOptions["tools"],
): { name: string; description?: string; input_schema: unknown }[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const mapped = tools
    .filter(isFunctionTool)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  return mapped.length > 0 ? mapped : undefined;
}

// ---------- 主类 ----------

export class CustomLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "custom";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {
    "image/*": [/^https?:\/\//i],
    "audio/*": [/^https?:\/\//i],
    "video/*": [/^https?:\/\//i],
    "application/pdf": [/^https?:\/\//i],
  };

  private readonly config: ModelConfig;
  private readonly apiFormat: ModelApiFormat;
  private readonly fetchFn: FetchFunction;
  private readonly generateIdFn: () => string;

  constructor(opts: CustomLanguageModelOptions) {
    this.config = opts.config;
    this.apiFormat = opts.config.apiFormat;
    this.fetchFn = opts.fetch ?? fetch;
    this.generateIdFn =
      opts.generateIdFn ?? createIdGenerator({ prefix: "msg" });
    this.modelId = opts.config.modelId;
  }

  get defaultObjectGenerationMode(): "json" | "tool" | "grammar" | undefined {
    return "tool";
  }

  private get baseURL() {
    return withoutTrailingSlash(this.config.baseURL);
  }

  private getAuthHeaders(extra?: Record<string, string | undefined>) {
    const headers: Record<string, string | undefined> = {
      "Content-Type": "application/json",
    };
    if (this.apiFormat === "openai") {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    } else {
      headers["x-api-key"] = this.config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
    return combineHeaders(headers, extra);
  }

  // ---------- doGenerate ----------
  async doGenerate(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    return this.apiFormat === "openai"
      ? this.doGenerateOpenAI(options)
      : this.doGenerateAnthropic(options);
  }

  private async doGenerateOpenAI(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const body = this.buildOpenAIBody(options, false);
    const { value, responseHeaders, rawValue } = await postJsonToApi({
      url: `${this.baseURL}/chat/completions`,
      headers: this.getAuthHeaders(options.headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: openAIErrorSchema,
        errorToMessage: (e) =>
          (e as { error?: { message?: string } })?.error?.message ??
          "Unknown error",
      }),
      successfulResponseHandler: createJsonResponseHandler(openAIChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.fetchFn,
    });

    const choice = value.choices?.[0];
    const msg = choice?.message;
    const content: LanguageModelV4Content[] = [];
    // reasoning content（思维链，在文本之前输出）
    const reasoning = msg?.reasoning_content;
    if (reasoning && reasoning.length > 0) {
      content.push({ type: "reasoning", text: reasoning });
    }
    if (msg?.content) content.push({ type: "text", text: msg.content });
    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        content.push({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }
    const usage = value.usage;
    const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
    return {
      content,
      finishReason: {
        unified: toUnifiedFinishReason(choice?.finish_reason),
        raw: choice?.finish_reason ?? undefined,
      },
      usage: {
        inputTokens: {
          total: usage?.prompt_tokens ?? undefined,
          // DeepSeek-V4: prompt_cache_miss_tokens 即非缓存输入 token
          noCache: usage?.prompt_cache_miss_tokens ?? undefined,
          cacheRead: usage?.prompt_cache_hit_tokens ?? undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: usage?.completion_tokens ?? undefined,
          // 有 reasoning_tokens 时按总量减去推理 token 算文本 token
          text:
            usage?.completion_tokens != null && reasoningTokens != null
              ? Math.max(0, usage.completion_tokens - reasoningTokens)
              : undefined,
          reasoning: reasoningTokens ?? undefined,
        },
      },
      warnings: [],
      request: { body: JSON.stringify(body) },
      response: {
        id: value.id ?? undefined,
        timestamp: new Date(),
        modelId: value.model ?? this.modelId,
        headers: responseHeaders,
        body: rawValue,
      },
    };
  }

  private async doGenerateAnthropic(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const body = this.buildAnthropicBody(options, false);
    const { value, responseHeaders, rawValue } = await postJsonToApi({
      url: `${this.baseURL}/messages`,
      headers: this.getAuthHeaders(options.headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: anthropicErrorSchema,
        errorToMessage: (e) => {
          const err = e as { error?: { message?: string }; type?: string };
          return err?.error?.message ?? err?.type ?? "Unknown Anthropic error";
        },
      }),
      successfulResponseHandler: createJsonResponseHandler(anthropicResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.fetchFn,
    });

    const content: LanguageModelV4Content[] = [];
    for (const block of value.content) {
      if (block.type === "text" && block.text) {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool-call",
          toolCallId: block.id ?? "",
          toolName: block.name ?? "",
          input: JSON.stringify(block.input ?? {}),
        });
      }
    }
    const usage = value.usage;
    return {
      content,
      finishReason: {
        unified: toUnifiedFinishReason(value.stop_reason),
        raw: value.stop_reason ?? undefined,
      },
      usage: {
        inputTokens: {
          total: usage?.input_tokens ?? undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: usage?.output_tokens ?? undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
      warnings: [],
      request: { body: JSON.stringify(body) },
      response: {
        id: value.id ?? undefined,
        timestamp: new Date(),
        modelId: value.model ?? this.modelId,
        headers: responseHeaders,
        body: rawValue,
      },
    };
  }

  // ---------- doStream ----------
  async doStream(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    return this.apiFormat === "openai"
      ? this.doStreamOpenAI(options)
      : this.doStreamAnthropic(options);
  }

  private async doStreamOpenAI(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    const body = this.buildOpenAIBody(options, true);
    const { value: eventStream, responseHeaders } = await postJsonToApi({
      url: `${this.baseURL}/chat/completions`,
      headers: this.getAuthHeaders(options.headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: openAIErrorSchema,
        errorToMessage: (e) =>
          (e as { error?: { message?: string } })?.error?.message ??
          "Unknown error",
      }),
      successfulResponseHandler: createEventSourceResponseHandler(
        openAIChatChunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.fetchFn,
    });

    const generateIdFn = this.generateIdFn;
    let textId: string | undefined;
    let reasoningId: string | undefined;
    let isActiveReasoning = false;
    let isActiveText = false;
    const toolCalls = new Map<
      number,
      { id: string; name: string; args: string; started: boolean }
    >();

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: async (controller) => {
        controller.enqueue({ type: "stream-start", warnings: [] });
        const reader = eventStream.getReader();
        try {
          for (;;) {
            const { done, value: parsed } = await reader.read();
            if (done) break;
            if (!parsed.success) {
              controller.enqueue({ type: "error", error: parsed.error });
              continue;
            }
            const chunk = parsed.value;
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            // 思维链 delta（在文本之前输出）
            const reasoningDelta = delta?.reasoning_content;
            if (reasoningDelta) {
              if (!isActiveReasoning) {
                const rid = generateIdFn();
                reasoningId = rid;
                controller.enqueue({
                  type: "reasoning-start",
                  id: rid,
                });
                isActiveReasoning = true;
              }
              controller.enqueue({
                type: "reasoning-delta",
                id: reasoningId!,
                delta: reasoningDelta,
              });
            }
            // 文本 delta：开始文本前先关闭 reasoning
            if (delta?.content) {
              if (!isActiveText) {
                if (isActiveReasoning && reasoningId) {
                  controller.enqueue({
                    type: "reasoning-end",
                    id: reasoningId,
                  });
                  isActiveReasoning = false;
                }
                textId = generateIdFn();
                controller.enqueue({ type: "text-start", id: textId });
                isActiveText = true;
              }
              controller.enqueue({
                type: "text-delta",
                id: textId!,
                delta: delta.content,
              });
            }
            if (delta?.tool_calls) {
              // 工具调用开始前也关闭 reasoning
              if (isActiveReasoning && reasoningId) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: reasoningId,
                });
                isActiveReasoning = false;
              }
              for (const tc of delta.tool_calls) {
                let entry = toolCalls.get(tc.index);
                if (!entry) {
                  entry = {
                    id: tc.id ?? generateIdFn(),
                    name: tc.function?.name ?? "",
                    args: "",
                    started: false,
                  };
                  toolCalls.set(tc.index, entry);
                }
                if (tc.function?.name && !entry.name) {
                  entry.name = tc.function.name;
                }
                if (!entry.started && entry.name) {
                  entry.started = true;
                  controller.enqueue({
                    type: "tool-input-start",
                    id: entry.id,
                    toolName: entry.name,
                  });
                }
                if (tc.function?.arguments) {
                  entry.args += tc.function.arguments;
                  if (entry.started) {
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: entry.id,
                      delta: tc.function.arguments,
                    });
                  }
                }
              }
            }
            const finishReason = choice?.finish_reason;
            if (finishReason) {
              if (isActiveReasoning && reasoningId) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: reasoningId,
                });
                isActiveReasoning = false;
              }
              if (isActiveText && textId) {
                controller.enqueue({ type: "text-end", id: textId });
                isActiveText = false;
                textId = undefined;
              }
              for (const entry of toolCalls.values()) {
                if (entry.started) {
                  controller.enqueue({ type: "tool-input-end", id: entry.id });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: entry.id,
                    toolName: entry.name,
                    input: entry.args,
                  });
                }
              }
              toolCalls.clear();
              controller.enqueue({
                type: "response-metadata",
                id: chunk.id ?? undefined,
                timestamp: new Date(),
                modelId: chunk.model ?? this.modelId,
              });
              const usage = chunk.usage;
              const reasoningTokens =
                usage?.completion_tokens_details?.reasoning_tokens;
              controller.enqueue({
                type: "finish",
                finishReason: {
                  unified: toUnifiedFinishReason(finishReason),
                  raw: finishReason,
                },
                usage: {
                  inputTokens: {
                    total: usage?.prompt_tokens ?? undefined,
                    noCache: usage?.prompt_cache_miss_tokens ?? undefined,
                    cacheRead: usage?.prompt_cache_hit_tokens ?? undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: {
                    total: usage?.completion_tokens ?? undefined,
                    text:
                      usage?.completion_tokens != null &&
                      reasoningTokens != null
                        ? Math.max(
                            0,
                            usage.completion_tokens - reasoningTokens,
                          )
                        : undefined,
                    reasoning: reasoningTokens ?? undefined,
                  },
                },
              });
            }
          }
        } catch (error) {
          controller.enqueue({ type: "error", error });
          const apiError = new Error(getErrorMessage(error)) as APICallError;
          (apiError as { name: string }).name = "AI_APICallError";
          (apiError as { url: string }).url = `${this.baseURL}/chat/completions`;
          (apiError as { requestBodyValues: unknown }).requestBodyValues = body;
          (apiError as { isRetryable: boolean }).isRetryable = false;
          throw apiError;
        } finally {
          controller.close();
        }
      },
    });

    return {
      stream,
      request: { body: JSON.stringify(body) },
      response: { headers: responseHeaders },
    };
  }

  private async doStreamAnthropic(
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    const body = this.buildAnthropicBody(options, true);
    const { value: eventStream, responseHeaders } = await postJsonToApi({
      url: `${this.baseURL}/messages`,
      headers: this.getAuthHeaders(options.headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: anthropicErrorSchema,
        errorToMessage: (e) => {
          const err = e as { error?: { message?: string }; type?: string };
          return err?.error?.message ?? err?.type ?? "Unknown Anthropic error";
        },
      }),
      successfulResponseHandler: createEventSourceResponseHandler(
        anthropicStreamEventSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.fetchFn,
    });

    const generateIdFn = this.generateIdFn;
    let textId: string | undefined;
    let toolInputId: string | undefined;
    let toolName: string | undefined;
    let toolArgs = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: string | undefined;
    let responseId: string | undefined;
    let responseModel: string | undefined;

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: async (controller) => {
        controller.enqueue({ type: "stream-start", warnings: [] });
        const reader = eventStream.getReader();
        try {
          for (;;) {
            const { done, value: parsed } = await reader.read();
            if (done) break;
            if (!parsed.success) {
              controller.enqueue({ type: "error", error: parsed.error });
              continue;
            }
            const ev = parsed.value;
            switch (ev.type) {
              case "message_start": {
                if (ev.message?.id) responseId = ev.message.id;
                if (ev.message?.model) responseModel = ev.message.model;
                if (ev.message?.usage) {
                  inputTokens = ev.message.usage.input_tokens ?? undefined;
                  outputTokens = ev.message.usage.output_tokens ?? undefined;
                }
                break;
              }
              case "content_block_start": {
                const block = ev.content_block;
                if (block?.type === "text") {
                  textId = generateIdFn();
                  controller.enqueue({ type: "text-start", id: textId });
                } else if (block?.type === "tool_use") {
                  const id = block.id ?? generateIdFn();
                  const name = block.name ?? "";
                  toolInputId = id;
                  toolName = name;
                  toolArgs = "";
                  controller.enqueue({
                    type: "tool-input-start",
                    id,
                    toolName: name,
                  });
                }
                break;
              }
              case "content_block_delta": {
                const d = ev.delta;
                if (d?.type === "text_delta" && d.text && textId) {
                  controller.enqueue({
                    type: "text-delta",
                    id: textId,
                    delta: d.text,
                  });
                } else if (d?.type === "input_json_delta" && toolInputId) {
                  toolArgs += d.partial_json ?? "";
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: toolInputId,
                    delta: d.partial_json ?? "",
                  });
                }
                break;
              }
              case "content_block_stop": {
                if (textId) {
                  controller.enqueue({ type: "text-end", id: textId });
                  textId = undefined;
                }
                if (toolInputId) {
                  const tcId = toolInputId;
                  const tcName = toolName ?? "";
                  controller.enqueue({
                    type: "tool-input-end",
                    id: tcId,
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: tcId,
                    toolName: tcName,
                    input: toolArgs,
                  });
                  toolInputId = undefined;
                  toolName = undefined;
                  toolArgs = "";
                }
                break;
              }
              case "message_delta": {
                if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
                if (ev.usage) {
                  outputTokens = ev.usage.output_tokens ?? outputTokens;
                }
                break;
              }
              case "message_stop": {
                controller.enqueue({
                  type: "response-metadata",
                  id: responseId,
                  timestamp: new Date(),
                  modelId: responseModel ?? this.modelId,
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: {
                    unified: toUnifiedFinishReason(stopReason),
                    raw: stopReason,
                  },
                  usage: {
                    inputTokens: {
                      total: inputTokens,
                      noCache: undefined,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: {
                      total: outputTokens,
                      text: undefined,
                      reasoning: undefined,
                    },
                  },
                });
                break;
              }
              case "error": {
                controller.enqueue({
                  type: "error",
                  error: new Error(
                    ev.error?.message ?? "Anthropic stream error",
                  ),
                });
                break;
              }
            }
          }
        } catch (error) {
          controller.enqueue({ type: "error", error });
        } finally {
          controller.close();
        }
      },
    });

    return {
      stream,
      request: { body: JSON.stringify(body) },
      response: { headers: responseHeaders },
    };
  }

  // ---------- body builders ----------
  private buildOpenAIBody(options: LanguageModelV4CallOptions, stream: boolean) {
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: convertToOpenAIMessages(options.prompt),
      stream,
    };
    body.max_tokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.topP !== undefined) body.top_p = options.topP;
    if (options.stopSequences) body.stop = options.stopSequences;
    if (options.presencePenalty !== undefined)
      body.presence_penalty = options.presencePenalty;
    if (options.frequencyPenalty !== undefined)
      body.frequency_penalty = options.frequencyPenalty;
    if (options.seed !== undefined) body.seed = options.seed;
    const tools = toOpenAITools(options.tools);
    if (tools) body.tools = tools;
    if (options.toolChoice) {
      const tc = options.toolChoice;
      if (tc.type === "auto") body.tool_choice = "auto";
      else if (tc.type === "none") body.tool_choice = "none";
      else if (tc.type === "required") body.tool_choice = "required";
      else if (tc.type === "tool")
        body.tool_choice = { type: "function", function: { name: tc.toolName } };
    }
    if (options.responseFormat?.type === "json") {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  private buildAnthropicBody(options: LanguageModelV4CallOptions, stream: boolean) {
    const { system, messages } = convertToAnthropicMessages(options.prompt);
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      stream,
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.topP !== undefined) body.top_p = options.topP;
    if (options.topK !== undefined) body.top_k = options.topK;
    if (options.stopSequences) body.stop_sequences = options.stopSequences;
    const tools = toAnthropicTools(options.tools);
    if (tools) body.tools = tools;
    if (options.toolChoice) {
      const tc = options.toolChoice;
      if (tc.type === "auto") body.tool_choice = { type: "auto" };
      else if (tc.type === "none") body.tool_choice = { type: "none" };
      else if (tc.type === "required") body.tool_choice = { type: "any" };
      else if (tc.type === "tool")
        body.tool_choice = { type: "tool", name: tc.toolName };
    }
    return body;
  }
}

/** 根据用户模型配置创建自定义 language model 实例 */
export function createCustomLanguageModel(
  config: ModelConfig,
  opts?: { fetch?: FetchFunction; generateIdFn?: () => string },
): CustomLanguageModel {
  return new CustomLanguageModel({ config, ...opts });
}

// 让 TS 把 ParseResult 当成 unused import 也算"已使用"
export type { ParseResult };
