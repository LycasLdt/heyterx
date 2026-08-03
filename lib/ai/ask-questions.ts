import { z } from "zod";

/**
 * askQuestions 工具的共享类型与输入 Schema。
 * 该工具是「客户端工具」：服务端只定义 inputSchema（无 execute），
 * agent 调用后循环暂停，由 chat-panel 渲染提问面板收集用户回答，
 * 再通过 addToolOutput 把结果回传给 agent 继续执行。
 */

/** 单个提问 */
export type AskQuestion = {
  /** 问题文本 */
  question: string;
  /** 候选选项（用户也可在「其他」中自由输入） */
  options: string[];
};

/** askQuestions 工具输入 */
export type AskQuestionsInput = {
  questions: AskQuestion[];
};

/** 单个问题的回答结果 */
export type AskQuestionsAnswer = {
  question: string;
  /** 用户选中的选项文本 / 自行输入的文本；未作答为「未回答」 */
  answer: string;
};

/** askQuestions 工具输出（由客户端在用户提交 / 超时 / 跳过后回传） */
export type AskQuestionsOutput = {
  answers: AskQuestionsAnswer[];
  /** true 表示超过 3 分钟未答完，按已填写内容自动提交 */
  timedOut: boolean;
  /** true 表示用户未作答、直接发送了新消息跳过提问（agent 应自主决策继续） */
  skipped: boolean;
};

/** 提问面板的等待超时时间：3 分钟 */
export const ASK_QUESTIONS_TIMEOUT_MS = 3 * 60 * 1000;

/** askQuestions 工具的输入 Schema（服务端注册用） */
export const askQuestionsInputSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("要向用户提问的问题，简洁明确"),
        options: z
          .array(z.string())
          .min(2)
          .max(6)
          .describe(
            "给用户的候选选项（2-6 个），覆盖最可能的情况；用户还可以选择「其他」自行输入",
          ),
      }),
    )
    .min(1)
    .max(5)
    .describe("一次可向用户提 1-5 个问题"),
});
