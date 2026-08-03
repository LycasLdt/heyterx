import {
  boolean,
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";

/**
 * 用户偏好设置（保存在 user.preferences jsonb 列）
 * better-auth 不管理此字段，由应用层直接读写
 */

/** 自定义模型 API 格式 */
export type ModelApiFormat = "openai" | "claude";

/** 单条自定义模型配置 */
export type ModelConfig = {
  /** 唯一 id（前端生成，uuid 或简单随机串） */
  id: string;
  /** 模型名称（用于展示，如「GPT-4o 多模态」） */
  name: string;
  /** API 格式：openai（/v1/chat/completions 兼容）/ claude（Anthropic /v1/messages） */
  apiFormat: ModelApiFormat;
  /** 模型 id（传给上游 API 的 model 字段，如 gpt-4o） */
  modelId: string;
  /** 调用地址（baseURL，如 https://api.openai.com/v1） */
  baseURL: string;
  /** API Key（明文存储于偏好；用户私有，仅服务端取用） */
  apiKey: string;
  /** 是否支持多模态（图片/音频/视频等附件输入） */
  multimodal: boolean;
};

/** 新一天打开后过去未完成任务的迁移模式 */
export type MigrationMode = "none" | "important" | "all";

/** Agent 提问模式：总是提问 / 尽可能不提问 / 绝不提问 */
export type AskMode = "always" | "minimal" | "never";

export type UserPreferences = {
  general: {
    /** 主题：light / dark / system */
    theme: "light" | "dark" | "system";
    /** 默认任务视图：list / quadrant */
    defaultTaskView: "list" | "quadrant";
  };
  agent: {
    /** 角色设定：用户自定义的 Agent 角色 prompt */
    role: string;
    /** 行为设定 */
    behavior: {
      /**
       * 新一天打开后过去未完成任务的迁移模式：
       * - "none"：不迁移
       * - "important"：仅迁移重要任务（重要且紧急 / 重要但不紧急）
       * - "all"：全部迁移
       * 默认 "important"
       */
      migrationMode: MigrationMode;
      /** 是否在新的一天问候（关闭后打开应用不再触发问候与迁移流程），默认 true */
      greetingEnabled: boolean;
      /**
       * Agent 提问模式：
       * - "always"：存在多种合理理解时总是先提问
       * - "minimal"：仅信息缺失且显著影响结果时提问（默认）
       * - "never"：绝不提问，一律自主决策
       */
      askMode: AskMode;
    };
  };
  models: {
    /** 默认对话模型 id；为空字符串时使用内置 deepseek-v4-flash */
    defaultModelId: string;
    /** 用户自定义的模型列表 */
    configs: ModelConfig[];
  };
};

/** 偏好的部分更新补丁（嵌套字段均可选，用于 PATCH 增量更新） */
export type PreferencesPatch = {
  general?: {
    theme?: UserPreferences["general"]["theme"];
    defaultTaskView?: UserPreferences["general"]["defaultTaskView"];
  };
  agent?: {
    role?: string;
    behavior?: {
      migrationMode?: MigrationMode;
      greetingEnabled?: boolean;
      askMode?: AskMode;
    };
  };
  models?: {
    defaultModelId?: string;
    configs?: ModelConfig[];
  };
};

/**
 * better-auth 标准表（属性名 camelCase，DB 列名 snake_case，与 better-auth 字段名匹配）
 * ID/时间戳由 better-auth 写入，故不加数据库默认值
 */

// 用户表 —— 与所有其他表关联
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  // 用户偏好设置（可空，better-auth 创建用户时不写入；应用层读取时 fallback 到默认值）
  preferences: jsonb("preferences").$type<UserPreferences>(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// 会话表
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// 账户表（OAuth / 邮箱密码）
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// 验证表
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/**
 * 应用业务表
 */

// 任务段表：一段时间范围内的任务归组（如「暑假任务段」），可为阶段性报告做铺垫
// 声明在 task 之前，因 task.segmentId 外键引用本表
export const taskSegment = pgTable("task_segment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// 任务表
export const task = pgTable("task", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  // 本地时区的 YYYY-MM-DD 字符串，与 app 的 formatDate 保持一致
  date: date("date").notNull(),
  // 重要度×紧急度四象限分类，取值见 queries.ts 的 IMPORTANCE_VALUES
  importance: text("importance").notNull().default("重要但不紧急"),
  // 五育分类（德/智/体/美/劳），取值见 queries.ts 的 CATEGORY_VALUES
  category: text("category").notNull().default("智育"),
  // 所属任务段 id（可选），关联 taskSegment，删除段时置 null
  // 任务段相当于任务树的根节点，段内任务默认是一级子节点
  segmentId: text("segment_id").references(() => taskSegment.id, {
    onDelete: "set null",
  }),
  // 母节点 id（可选），自引用 task.id 形成任务树；删除母节点时子节点级联删除
  // 为 null 表示一级子节点（既有任务默认全部为一级子节点）
  parentId: text("parent_id").references((): AnyPgColumn => task.id, {
    onDelete: "cascade",
  }),
  // 节点元数据（可选 JSON 对象），如 {"index": 4} 标注兄弟节点间的顺序（「第4练」→ 4）
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  // 提醒时间（可选，ISO 字符串）；到点由 Service Worker 触发浏览器通知
  reminderAt: timestamp("reminder_at", { withTimezone: true }),
  // 提醒是否已触发（避免重复通知）；触发后置 true
  reminderNotified: boolean("reminder_notified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI 对话表
export const conversation = pgTable("conversation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  messages: jsonb("messages").$type<UIMessage[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 报告相关类型（jsonb 字段的结构化数据）
 */
export type ReportType = "weekly" | "monthly" | "stage";

/** 心理绿芽指数单维度 */
export type GrowthDimension = {
  category: string; // 智育/体育/德育/美育/劳育
  label: string; // 认知掌控感/生理活力值/人际连接感/情绪舒缓度/生活掌控感
  score: number; // 0-100 该维度完成率
  weight: number; // 权重 0.25/0.25/0.20/0.15/0.15
};

/** 报告结构化指标 */
export type ReportMetrics = {
  totalTasks: number;
  completedTasks: number;
  completionRate: number; // 0-100
  categoryDistribution: Array<{
    category: string;
    count: number;
    completed: number;
    rate: number; // 0-100
  }>;
  importanceDistribution: Array<{
    importance: string;
    count: number;
    completed: number;
  }>;
  growthIndex: {
    total: number; // 0-100 加权总分
    dimensions: GrowthDimension[];
  };
};

/** 下周期规划任务（供「应用」按钮一键创建） */
export type ReportPlan = Array<{
  title: string;
  importance: string;
  category: string;
  date: string; // YYYY-MM-DD
}>;

// 报告表：周报/月报/阶段报，存结构化指标 + AI 文字总结 + 下周期规划
export const report = pgTable("report", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "weekly" | "monthly" | "stage"
  title: text("title").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  segmentId: text("segment_id").references(() => taskSegment.id, {
    onDelete: "set null",
  }),
  // AI 生成的 markdown 文字总结
  summary: text("summary").notNull(),
  // 结构化指标：完成率、五育分布、四象限分布、心理绿芽指数
  metrics: jsonb("metrics").$type<ReportMetrics>().notNull(),
  // 下周期规划任务（供「应用」按钮一键创建）
  plan: jsonb("plan").$type<ReportPlan>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
