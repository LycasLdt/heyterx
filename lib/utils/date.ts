// 日期工具：统一使用本地时区的 YYYY-MM-DD 格式，避免 UTC 偏移导致的日期错位

/** 把 Date 格式化为 YYYY-MM-DD（按本地时区） */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 把 YYYY-MM-DD 解析为本地时区的 Date */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 把 YYYY-MM-DD 格式化为日期分割线标签：今天 / 昨天 / M月D日 周X */
export function formatDateDivider(dateStr: string, today: string): string {
  if (dateStr === today) return "今天";
  const t = parseDate(today);
  t.setDate(t.getDate() - 1);
  if (dateStr === formatDate(t)) return "昨天";
  const d = parseDate(dateStr);
  const weekday = WEEKDAY_LABELS[(d.getDay() + 6) % 7];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekday}`;
}

/** 获取包含某天的那一周（周一到周日）的 7 个日期 */
export function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  // getDay(): 0=周日 ... 6=周六；以周一为一周起点
  const offsetToMonday = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - offsetToMonday);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    dates.push(cur);
  }
  return dates;
}

/** 周一到周日的中文标签（与 getWeekDates 顺序一致） */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** ISO 时间转 datetime-local 输入框值（YYYY-MM-DDTHH:mm） */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/** datetime-local 输入框值转 ISO 字符串 */
export function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}
