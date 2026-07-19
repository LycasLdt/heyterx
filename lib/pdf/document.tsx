import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Task } from "@/lib/db/queries";
import { ensureChineseFont, FONT_FAMILY } from "./fonts";

/** loadTasksInRange 返回的任务类型：Task + date */
type TaskWithDate = Task & { date: string };

export interface PdfRenderOptions {
  tasks: TaskWithDate[];
  startDate: string;
  endDate: string;
  segmentName?: string;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    padding: 32,
    color: "#1f2937",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  brand: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#111827",
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 18,
    marginBottom: 8,
    color: "#111827",
  },
  subtitle: {
    fontSize: 10,
    color: "#6b7280",
    marginBottom: 16,
  },
  dateHeader: {
    fontSize: 12,
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    color: "#111827",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  checkbox: {
    width: 12,
    height: 12,
    borderWidth: 1,
    borderColor: "#374151",
    marginTop: 2,
    marginRight: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  checkmark: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#111827",
    lineHeight: 1,
  },
  taskTitle: {
    flex: 1,
    fontSize: 11,
    paddingRight: 8,
  },
  taskTitleDone: {
    flex: 1,
    fontSize: 11,
    paddingRight: 8,
    textDecoration: "line-through",
    color: "#6b7280",
  },
  badge: {
    fontSize: 9,
    color: "#6b7280",
    width: 56,
  },
  badgeWide: {
    fontSize: 9,
    color: "#6b7280",
    width: 88,
  },
});

/**
 * 任务计划 PDF 文档：按日期分组的任务表格 + 打卡框。
 * 用于打印/导出任务段或任意时间段的计划。
 */
export function TaskPdfDocument({
  tasks,
  startDate,
  endDate,
  segmentName,
}: PdfRenderOptions) {
  // 按日期分组
  const byDate = new Map<string, TaskWithDate[]>();
  for (const t of tasks) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }
  const dates = [...byDate.keys()].sort();
  const title = segmentName ?? "任务计划";
  const completed = tasks.filter((t) => t.done).length;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* 页头：heyterx 品牌 + 标语 */}
        <View style={styles.header}>
          <Text style={styles.brand}>heyterx</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          {startDate} ~ {endDate} · 共 {tasks.length} 项 · 已完成 {completed}
        </Text>
        {dates.map((d) => {
          const dayTasks = byDate.get(d)!;
          return (
            <View key={d} wrap={false}>
              <Text style={styles.dateHeader}>{d}</Text>
              {dayTasks.map((t) => (
                <View key={t.id} style={styles.row}>
                  {/* 打卡框：未完成空方框；已完成方框内打勾 */}
                  <View style={styles.checkbox}>
                    {t.done && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={t.done ? styles.taskTitleDone : styles.taskTitle}>
                    {t.title}
                  </Text>
                  <Text style={styles.badge}>{t.category}</Text>
                  <Text style={styles.badgeWide}>{t.importance}</Text>
                </View>
              ))}
            </View>
          );
        })}
        {tasks.length === 0 && (
          <Text style={{ fontSize: 11, color: "#6b7280", marginTop: 24 }}>
            该时间段内没有任务。
          </Text>
        )}
      </Page>
    </Document>
  );
}

/**
 * 渲染任务计划 PDF 为 Buffer（服务端调用）。
 * 内部确保中文字体已注册，多次调用安全。
 */
export async function renderTaskPdf(
  opts: PdfRenderOptions,
): Promise<Buffer> {
  console.log("Ensuring Chinese font ...")
  await ensureChineseFont();
  console.log("Rendering document ...")
  return renderToBuffer(<TaskPdfDocument {...opts} />);
}
