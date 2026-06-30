import { drizzle } from "drizzle-orm/node-postgres";
import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

// Drizzle 1.0 beta：使用 defineRelations 定义表之间的关系
// 需在 one 端显式声明 from/to 列，many 端由反向关系推断
const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    tasks: r.many.task(),
    taskSegments: r.many.taskSegment(),
    conversations: r.many.conversation(),
    reports: r.many.report(),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id }),
  },
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id }),
  },
  taskSegment: {
    user: r.one.user({ from: r.taskSegment.userId, to: r.user.id }),
    tasks: r.many.task(),
  },
  task: {
    user: r.one.user({ from: r.task.userId, to: r.user.id }),
    segment: r.one.taskSegment({ from: r.task.segmentId, to: r.taskSegment.id }),
  },
  conversation: {
    user: r.one.user({ from: r.conversation.userId, to: r.user.id }),
  },
  report: {
    user: r.one.user({ from: r.report.userId, to: r.user.id }),
    segment: r.one.taskSegment({ from: r.report.segmentId, to: r.taskSegment.id }),
  },
}));


export const db = drizzle(process.env.DATABASE_URL!, { schema, relations });
