import {
  type TranscriptionModelV4,
  type TranscriptionModelV4CallOptions,
  type TranscriptionModelV4Result,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  convertToBase64,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  postJsonToApi,
  withoutTrailingSlash,
  type FetchFunction,
} from "@ai-sdk/provider-utils";
import { z } from "zod";

/**
 * MiMo-V2.5-ASR 语音识别模型。
 *
 * MiMo ASR 不走 OpenAI 标准 /audio/transcriptions（form-data），
 * 而是走 /v1/chat/completions 兼容协议，把音频作为 user 消息的 input_audio 内容块传入，
 * 配合顶层 asr_options.language 字段。返回也是标准 chat completion 格式，
 * 识别结果在 choices[0].message.content。
 *
 * 参考文档：
 * https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/Speech-Recognition
 *
 * 该模型只支持非流式 doGenerate。
 */
export interface MimoTranscriptionConfig {
  /** API key（必传，调用方从用户配置或环境变量取） */
  apiKey: string;
  /** Base URL，默认 https://api.xiaomimimo.com/v1 */
  baseURL?: string;
  /** 自定义 fetch */
  fetch?: FetchFunction;
  /** 鉴权 header 名，默认 "Authorization"，部分代理需要 "api-key" */
  authHeader?: "Authorization" | "api-key";
  /** 额外 header */
  headers?: Record<string, string | undefined>;
}

export interface MimoTranscriptionProviderOptions {
  /** 语种：auto / zh / en，默认 auto */
  language?: "auto" | "zh" | "en";
}

const mimoResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string().nullish(),
        content: z.string().nullish(),
      }),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
    })
    .nullish(),
});

const mimoErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
});

export class MimoTranscriptionModel implements TranscriptionModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "mimo";
  readonly modelId: string;

  private readonly config: MimoTranscriptionConfig;

  constructor(modelId: string, config: MimoTranscriptionConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  private get baseURL() {
    return withoutTrailingSlash(
      this.config.baseURL ?? "https://api.xiaomimimo.com/v1",
    );
  }

  private getHeaders(extra?: Record<string, string | undefined>) {
    const authHeader = this.config.authHeader ?? "api-key";
    const authValue =
      authHeader === "Authorization"
        ? `Bearer ${this.config.apiKey}`
        : this.config.apiKey;
    return combineHeaders(
      {
        [authHeader]: authValue,
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      extra,
    );
  }

  async doGenerate(
    options: TranscriptionModelV4CallOptions,
  ): Promise<TranscriptionModelV4Result> {
    const mimoOptions = (options.providerOptions?.mimo ??
      {}) as MimoTranscriptionProviderOptions;
    const language = mimoOptions.language ?? "auto";

    // audio 是 Uint8Array 或 base64 字符串；统一转 base64
    const audioBase64 = convertToBase64(options.audio);
    // 从 mediaType 推断 MIME（前端传 image/audio/video/* 都可，这里只用 audio）
    const mimeType = options.mediaType || "audio/wav";
    const dataUrl = `data:${mimeType};base64,${audioBase64}`;

    const body = {
      model: this.modelId,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: dataUrl },
            },
          ],
        },
      ],
      asr_options: { language },
    };

    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: `${this.baseURL}/chat/completions`,
      headers: this.getHeaders(options.headers),
      body,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: mimoErrorSchema,
        errorToMessage: (error) => {
          console.log(error)
          return (
            (error as { error?: { message?: string } })?.error?.message ??
            "Unknown MiMo error"
          );
        },
      }),
      successfulResponseHandler: createJsonResponseHandler(mimoResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      segments: [
        {
          text,
          startSecond: 0,
          endSecond: 0,
        },
      ],
      language: language === "auto" ? undefined : language,
      durationInSeconds: undefined,
      warnings: [],
      request: { body: JSON.stringify(body) },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
    };
  }
}

/**
 * 创建 MiMo ASR transcription model 实例。
 *
 * @param modelId 模型 id，默认 mimo-v2.5-asr
 * @param config 鉴权与 baseURL 配置
 */
export function createMimoTranscription(
  config: MimoTranscriptionConfig,
  modelId = "mimo-v2.5-asr",
): MimoTranscriptionModel {
  return new MimoTranscriptionModel(modelId, config);
}
