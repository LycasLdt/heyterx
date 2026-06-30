import { boolean, date, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";

/**
 * 用户偏好设置（保存在 user.preferences jsonb 列）
 * better-auth 不管理此字段，由应用层直接读写
 */
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
    /** 技能设定：用户为 Agent 添加的多项技能 prompt */
    skills: string[];
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
    skills?: string[];
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
  segmentId: text("segment_id").references(() => taskSegment.id, {
    onDelete: "set null",
  }),
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
