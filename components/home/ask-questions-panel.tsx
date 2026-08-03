"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleQuestionMark } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ASK_QUESTIONS_TIMEOUT_MS,
  type AskQuestion,
  type AskQuestionsAnswer,
} from "@/lib/ai/ask-questions";

/**
 * 单个问题的作答状态：
 * selected 为选中的选项序号、"custom"（其他）或 null（未选择）；
 * customText 为「其他」输入框内容（切换到选项后保留，方便切回）
 */
type AnswerState = { selected: number | "custom" | null; customText: string };

const EMPTY_ANSWER: AnswerState = { selected: null, customText: "" };

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
/** RadioGroup 中「其他」选项的 value（选项序号为纯数字，不会冲突） */
const CUSTOM_VALUE = "__custom__";

/** 把作答状态整理为工具输出（未作答的问题标记为「未回答」） */
function buildAnswers(
  questions: AskQuestion[],
  answers: AnswerState[],
): AskQuestionsAnswer[] {
  return questions.map((q, i) => {
    const a = answers[i] ?? EMPTY_ANSWER;
    if (typeof a.selected === "number") {
      return { question: q.question, answer: q.options[a.selected] ?? "未回答" };
    }
    if (a.selected === "custom" && a.customText.trim()) {
      return { question: q.question, answer: a.customText.trim() };
    }
    return { question: q.question, answer: "未回答" };
  });
}

/** 是否已作答（选中了选项，或「其他」输入了内容） */
function isAnswered(a: AnswerState): boolean {
  return (
    typeof a.selected === "number" ||
    (a.selected === "custom" && a.customText.trim().length > 0)
  );
}

/** 圆形进度条（shadcn 无环形进度组件，用小号 SVG 实现） */
function CircleProgress({ value, total }: { value: number; total: number }) {
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const pct = total > 0 ? value / total : 0;
  return (
    <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden>
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2.5"
        className="stroke-muted"
      />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-primary transition-[stroke-dashoffset] duration-300"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
      />
    </svg>
  );
}

/**
 * agent 提问面板：由 chat-panel 悬浮定位于消息滚动容器之上（absolute），
 * 组件本身不含定位与外边距。
 * 顶部为问题序号 + 问题 + 前后切换；中间竖向列出「A.」「B.」…选项与
 * 「其他」自由输入；底部为完成程度（圆形进度条 + 已完成/总数）与
 * 「下一步/提交」按钮。3 分钟未提交则按已填写内容自动提交。
 */
export function AskQuestionsPanel({
  questions,
  onSubmit,
}: {
  questions: AskQuestion[];
  /** 提交回答；timedOut=true 表示 3 分钟超时自动提交 */
  onSubmit: (answers: AskQuestionsAnswer[], timedOut: boolean) => void;
}) {
  const idPrefix = useId();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerState[]>(() =>
    questions.map(() => EMPTY_ANSWER),
  );
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const submittedRef = useRef(false);

  // 3 分钟超时：按已填写的回答自动提交
  useEffect(() => {
    const timer = setTimeout(() => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      onSubmitRef.current(buildAnswers(questions, answersRef.current), true);
    }, ASK_QUESTIONS_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = questions.length;
  const current = questions[index]!;
  const answeredCount = answers.filter(isAnswered).length;
  const isLast = index === total - 1;
  const currentAnswer = answers[index] ?? EMPTY_ANSWER;

  const submit = (timedOut: boolean) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(buildAnswers(questions, answersRef.current), timedOut);
  };

  const patchCurrent = (patch: Partial<AnswerState>) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = { ...(prev[index] ?? EMPTY_ANSWER), ...patch };
      return next;
    });
  };

  const radioValue =
    currentAnswer.selected === "custom"
      ? CUSTOM_VALUE
      : typeof currentAnswer.selected === "number"
        ? String(currentAnswer.selected)
        : "";

  return (
    <Card size="sm" className="shadow-lg">
      {/* 顶部：问题序号 + 问题 + 前后切换 */}
      <CardHeader className="border-b">
        <CardTitle className="flex min-w-0 items-baseline gap-2">
          <CircleQuestionMark className="size-4 shrink-0 self-center text-primary" />
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            问题 {index + 1}/{total}
          </span>
          <span className="min-w-0">{current.question}</span>
        </CardTitle>
        <CardAction className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="上一个问题"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="下一个问题"
            disabled={isLast}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            <ChevronRight data-icon="inline-start" />
          </Button>
        </CardAction>
      </CardHeader>

      {/* 中间：竖向选项 A. B. … + 其他输入 */}
      <CardContent>
        <RadioGroup
          value={radioValue}
          onValueChange={(v) => {
            if (v === CUSTOM_VALUE) patchCurrent({ selected: "custom" });
            else patchCurrent({ selected: Number(v) });
          }}
          className="gap-2"
        >
          {current.options.map((option, i) => {
            const id = `${idPrefix}-q${index}-opt-${i}`;
            return (
              <div key={i} className="flex items-center gap-2">
                <RadioGroupItem id={id} value={String(i)} />
                <Label
                  htmlFor={id}
                  className="min-w-0 flex-1 cursor-pointer truncate font-normal"
                >
                  <span className="font-medium">{OPTION_LETTERS[i]}.</span>{" "}
                  {option}
                </Label>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <RadioGroupItem
              id={`${idPrefix}-q${index}-custom`}
              value={CUSTOM_VALUE}
            />
            <Label
              htmlFor={`${idPrefix}-q${index}-custom`}
              className="shrink-0 cursor-pointer font-normal"
            >
              其他:
            </Label>
            <Input
              value={currentAnswer.customText}
              onChange={(e) =>
                patchCurrent({ selected: "custom", customText: e.target.value })
              }
              onFocus={() => {
                // 聚焦输入框即选中「其他」（空文本不计入完成度）
                if (currentAnswer.selected !== "custom") {
                  patchCurrent({ selected: "custom" });
                }
              }}
              placeholder="自行输入回答"
              className="h-7 min-w-0 flex-1"
            />
          </div>
        </RadioGroup>
      </CardContent>

      {/* 底部：完成程度 + 下一步/提交 */}
      <CardFooter className="border-t">
        <CircleProgress value={answeredCount} total={total} />
        <span className="ml-2 text-xs text-muted-foreground">
          {answeredCount}/{total}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          onClick={() => (isLast ? submit(false) : setIndex((i) => i + 1))}
        >
          {isLast ? "提交" : "下一步"}
        </Button>
      </CardFooter>
    </Card>
  );
}
