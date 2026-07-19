import { getSessionUser } from "@/lib/auth";
import { DEFAULT_ASR_MODEL, userQueries } from "@/lib/db/queries";
import { createMimoTranscription } from "@/lib/ai/mimo-transcription";
import { transcribe } from "ai";

export const runtime = "nodejs";

/**
 * 语音识别接口。
 *
 * 客户端 POST multipart/form-data：
 *   - file: 音频文件（webm/wav/mp3/m4a 等）
 *
 * 返回 { text: string }
 *
 * 使用 MiMo-V2.5-ASR 模型（默认）。
 * 用户若在偏好里配置了同名/指定的 ASR 配置则用之，否则用默认配置，
 * apiKey 从环境变量 MIMO_API_KEY 读取。
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "未提供音频文件" }, { status: 400 });
  }

  // 读取用户偏好中的 apiKey（如果用户在 models 配置里加了 mimo-v2.5-asr）
  // 使用解密版偏好：服务端调用 MiMo 需要 apiKey 明文
  const preferences = await userQueries.getPreferencesDecrypted(user.id);
  const asrConfig = preferences.models?.configs?.find(
    (c) => c.modelId === DEFAULT_ASR_MODEL.modelId,
  );
  const apiKey = asrConfig?.apiKey || process.env.MIMO_API_KEY || "";
  if (!apiKey) {
    return Response.json(
      {
        error:
          "未配置 MIMO_API_KEY，请在环境变量或「设置 → Agent → 模型」中配置 mimo-v2.5-asr 的 api key",
      },
      { status: 500 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const model = createMimoTranscription(
    {
      apiKey,
      baseURL: asrConfig?.baseURL || DEFAULT_ASR_MODEL.baseURL,
    },
    DEFAULT_ASR_MODEL.modelId,
  );
  try {
    const result = await transcribe({
      model,
      audio: bytes,
      abortSignal: req.signal,
    });
    return Response.json({ text: result.text });
  } catch (e) {
    console.log(e instanceof Error ? e.message : "语音识别失败");
    return Response.json(
      {
        error: e instanceof Error ? e.message : "语音识别失败",
      },
      { status: 500 },
    );
  }
}
