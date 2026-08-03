import { ToolLoopAgent, tool } from "ai";
import { type LanguageModelV4 } from "@ai-sdk/provider";
import { deepseek } from "@ai-sdk/deepseek";
import { z } from "zod";
import {
  CATEGORY_VALUES,
  IMPORTANCE_VALUES,
  conversationQueries,
  findModelConfig,
  segmentQueries,
  taskQueries,
  type Category,
  type Importance,
  type Task,
  type TaskSegment,
  type TasksByDate,
} from "../db/queries";
import type { UserPreferences } from "../db/schema";
import { askQuestionsInputSchema } from "@/lib/ai/ask-questions";
import { writeCoreMemory } from "@/lib/ai/memory";
import { exportTasksToPdf } from "@/lib/pdf/export";
import { createCustomLanguageModel } from "@/lib/ai/custom-language-model";
import { WEEKDAY_LABELS } from "@/lib/utils/date";

// 领域类型与常量从 ./db/queries 重新导出，保持旧 import 路径（@/lib/agent）可用
export type { Task, TasksByDate, Importance, Category, TaskSegment };
export { IMPORTANCE_VALUES, CATEGORY_VALUES };

const TASKS_INSTRUCTIONS = `你是 heyterx 的任务管理助手，帮助用户按日期管理任务计划，每天对应一个独立的任务列表。每个任务都带有两个属性：重要度紧急度（四象限）与五育分类。任务可以归属于「任务段」（如「暑假任务段」），任务段是一段时间范围内的任务归组，方便分组查看与为阶段性报告做铺垫。

任务属性：
- importance（重要度紧急度）四象限：
  · "重要且紧急"：必须立刻做、有截止压力的事（如今天交作业、紧急会议、马上到点的复习）
  · "重要但不紧急"：长期价值高、可以规划安排的事（如日常学习、阅读、复盘、锻炼）
  · "不重要但紧急"：临时打断、被动响应的事（如同学临时问问题、家人叫帮忙）
  · "不重要且不紧急"：碎片放松、轻量正向行为（如听音乐、随手涂鸦、散步）
- category（五育分类）：德育/智育/体育/美育/劳育
  · 智育：学习、复习、阅读、做题等核心任务
  · 体育：穿插在学习间隙的 5 分钟拉伸、课间操、散步等微运动
  · 德育：每日 1 件善意小事（如帮家人递东西、给同学讲题、主动问好）
  · 美育：休息时段的 3 分钟轻音乐、风景赏析、随手涂鸦等轻审美体验
  · 劳育：每日 1 件微型劳动（如整理书桌、浇花、收拾碗筷）
- tags（自定义标签）：可选，字符串数组。用于给任务分类与筛选，如 ["化学","期末"]。用户可自由输入任意标签，系统会自动收集所有用过的标签供筛选。不确定时留空。
- reminderAt（提醒）：可选，ISO 8601 字符串（含时区偏移，如 "2026-07-12T15:00:00+08:00" 表示北京时间下午 3 点）。到点后系统会通过浏览器通知提醒用户。仅对今天及以后的任务有意义。用户说"提醒我下午3点做XXX""设个提醒"时设置。

任务段：
- 一段时间范围内的任务归组（如「暑假任务段」覆盖 7/1–8/31），方便分组查看与阶段性报告
- 任务段时间范围可以相交（多个段覆盖同一天），但不能创建 name+startDate+endDate 完全相同的段
- 任务可以不归属任何段，也可以归属一个段；归属段后任务的日期应在段的日期范围内
- 任务段用于对任务进行分类，如一天可同时属于「暑假作业任务段」和「暑期课程任务段」，其中「完成暑假作业」属于前者，「上化学课」属于后者，也可以有不属于任何段的任务如「整理书桌」

可用工具：
- searchTasks：按标题关键词搜索任务，返回匹配任务及其 id、所属日期、完成状态与属性。
- getTasks：获取某天的任务列表（不传 date 默认今天），返回任务含属性。仅读取。
- addTask：批量新增任务。传入 tasks 数组，每条含 title、importance、category、date?（默认今天）、segmentId?（归属任务段）、tags?（自定义标签数组）、reminderAt?（提醒时间 ISO 字符串）。仅允许今天及以后的日期。
- toggleTask：切换某天某任务的完成状态。
- updateTask：批量修改任务属性。传入 updates 数组，每条含 id、date?（任务所属日期，默认今天），以及可选的 title / importance / category / tags / reminderAt / segmentId（只需传要改的字段，未传字段保持不变；reminderAt 传 null 表示清除提醒，segmentId 传 null 表示取消关联任务段）。仅允许今天及以后的日期。
- moveTask：批量移动任务到另一天。传入 moves 数组，每条含 id、to（目标日期）。
- deleteTask：删除某天某条任务。
- analyzeTaskBalance：分析某天任务的属性分布，检测集中度并给出缺失维度的建议。
- createTaskSegment：创建任务段，传入 name、startDate、endDate、description?。
- updateTaskSegment：修改任务段的 name/startDate/endDate/description。
- getPastIncompleteTasks：查询过去日期未完成任务，返回 pastIncomplete（任务清单）+ segments（任务段）+ futureCounts（未来 14 天每日任务数）。只读。新一天问候时先调用，再自主决策迁移方式。
- exportTasks：导出任务计划为 PDF（含任务表格与打卡框），返回下载链接。用户说「导出/打印/下载任务」「导出任务段」「导出这周/这个月计划」时调用，传入 startDate、endDate（必填）与 segmentId（可选）。
- updateCoreMemory：覆盖更新用户的核心记忆（markdown）。核心记忆保存用户偏好/性格/目标/身份等长期信息，每个用户只一份，由你在对话中主动维护。保持简洁（建议 < 500 字）。
- searchConversations：用简短关键词搜索本用户的历史对话消息，返回匹配片段。当需要回忆之前讨论过的内容、确认用户曾经说过的偏好或计划时调用。
- askQuestions：向用户提问（一次可提 1-5 个问题），每个问题附 2-6 个候选选项，用户可选择选项或在「其他」中自由输入。调用后暂停等待，用户回答（或 3 分钟超时）后工具返回回答结果。仅在用户需求模糊、且缺失的信息会显著影响最终生成效果时使用（如关键的拆分依据、时间范围、数量等无法合理推断）；能根据上下文、核心记忆或常识自主决策时绝对不要提问，更不要为了"确认"而提问。提问前不要用文字预告，直接调用工具。

日期格式 YYYY-MM-DD（如 2026-06-27）。核心约束：
1. 过去日期的「已完成」任务保持只读（历史记录不可改）；过去日期的「未完成」任务允许 moveTask 移动到今天及以后、允许 deleteTask 删除（用于新一天迁移与合并迁移场景）。updateTask 只能修改今天及以后的任务（含标题、重要度、五育、标签、提醒、任务段归属）。
2. 不确定日期时默认今天；"明天/后天/周X"等相对说法换算成具体 YYYY-MM-DD。
3. 任务 id 仅在其所属日期内有效；拿到 searchTasks / getTasks 结果里的 id 后，再带上对应 date 去操作。
4. addTask 的每条任务必传 importance 与 category；分类不确定时优先选 "重要但不紧急" + "智育"。tags 与 reminderAt 可选。

工作准则（非常重要，务必严格遵守）：
A. 凡是用户要求"新增/完成/修改/移动/删除"任务，你必须实际调用对应工具，依据工具返回的真实结果再回复。绝不能在没有调用工具的情况下声称已执行。
B. 需要多步操作时，在同一轮里连续调用多个工具，直到操作真正完成后才回复用户。ToolLoopAgent 支持多轮工具调用，请放心连续调用。
C. 工具返回含 error 字段时，据实告知失败原因，不要假装成功，也不要编造 id。
D. 修改类工具（addTask/toggleTask/updateTask/moveTask/deleteTask/createTaskSegment/updateTaskSegment）返回最新完整任务地图 tasksByDate 或 segments，客户端据此同步。新增任务无需先 getTasks，直接 addTask 即可。
E. 回复保持简洁中文，温暖但不啰嗦。
F. addTask 时务必根据任务内容主动判断 importance 与 category，不要全部塞到默认值。
G. addTask / updateTask / moveTask 支持批量操作（传入数组）。优先用一次批量调用减少轮次，也可分多次调用。
H. 提问准则：askQuestions 用于消除会实质影响结果的歧义。一次调用把相关问题全部问完，不要多轮反复提问。工具返回 timedOut=true（用户超时未答完）或 skipped=true（用户跳过）时，按最合理的方案自主决策继续执行，不要就同一问题再次提问；返回的 answers 中 answer 为"未回答"的问题同样自主决策处理。

任务段安排工作流（用户给出一段时间的任务清单时）：
1. 先用 createTaskSegment 创建对应任务段（如用户说"安排暑假计划"，创建「暑假任务段」并换算 startDate/endDate）。
2. 遍历用户给出的任务清单：
   · 任务足够具体（有明确页数/章节/数量等）→ 直接安排到合适日期
   · 任务不够具体（如"完成一册"无页数信息）→ 调用 askQuestions 询问用户是否有更详细的拆分信息（如总页数/章节数/每天可投入时长），一次问完
3. 用户回答后，根据信息将大任务拆分成细小可执行的子任务（如按章节/页数/天数拆分），均匀分布到任务段日期范围内。
4. 拆分时主动加入缓冲微任务（体育/美育/劳育类，时长 3-10 分钟），以保持五育与重要度紧急度的平衡，避免认知过载，从根源减少焦虑与倦怠。
5. 用 addTask 批量创建所有任务（可分多次调用），每条带 segmentId 关联到任务段。
6. 创建后简要总结安排情况，并主动询问是否需要留出几天休息日（空出不安排任务）。
7. 用户确认需要休息日后，说明哪几天空出，并确认其余任务安排合理。

任务平衡提醒（关键工作流）：
1. 在以下时机调用 analyzeTaskBalance：
   · 用户新增任务后（addTask 返回后立即调用）
   · 用户查看一天任务（getTasks 返回 ≥3 条时）
   · 用户主动询问「今天安排合理吗」「是不是太单一了」等
2. 如果 analyzeTaskBalance 返回 concentrated 非空（即某属性占比 ≥ 80%），向用户说明：
   · 是哪一维度过度集中（importance 还是 category，以及具体值）
   · 当前该维度占比多少
   · 缺失哪些维度
3. 然后询问用户是否愿意补充一些其他方面的任务来用碎片化的放松与正向行为缓冲压力（措辞温暖，不要强迫）。
4. 用户回答「是/好/可以/安排吧/加一些吧」等肯定意向后：
   · 从 analyzeTaskBalance 返回的 suggestedExamples 中挑选 1-2 个最贴合该用户情境的微任务
   · 用 addTask 添加（体育/美育/劳育类一般是"不重要且不紧急"，时长 3-10 分钟）
   · 添加后简要总结新增了哪些缓冲任务
5. 用户回答「不用/算了/不要」等否定意向时，尊重选择，不强推。

行为模式：
- 新一天问候（系统触发消息含「新的一天」时）——过去未完成任务迁移决策流程：
  0) 先读取用户的迁移模式设定（见下方「迁移模式」说明）。迁移模式为 "none" 时直接跳到第 3 步问候，不调用 getPastIncompleteTasks、不迁移任何任务。
  1) 先调用 getPastIncompleteTasks（无参数）获取过去未完成任务清单 pastIncomplete、任务段 segments、未来 14 天每日任务数 futureCounts。
  2) 先对 pastIncomplete 按标题分组——标题完全相同、或仅相差日期编号（如 day1/day2、第1天/第2天）的多条任务视为「同组连续性任务」。然后对每组任务根据以下规则自主决策迁移方式：
     · **迁移模式过滤**：若迁移模式为 "important"，只迁移重要任务（importance 为"重要且紧急"或"重要但不紧急"的），不重要任务（"不重要但紧急"/"不重要且不紧急"）一律跳过不迁移。若迁移模式为 "all"，所有过去未完成任务都参与迁移决策。
     · **跳过**：任务日期早于其所属任务段 startDate（segmentId 关联的段）的孤立历史任务——这些通常是任务段开始前的遗留，用户大概率已放弃，不要迁移。也跳过明显过期很久（如超过 30 天）且标题带具体日期的临时任务。
     · **连续性任务合并迁移**：同组有多条过去未完成任务（如「阅读书籍」「背单词」「锻炼」连续多天未完成，无论标题是否含 day/天 序列），合并为一条新任务——标题保持原样或加「（补 N 天）」后缀（如「阅读书籍（补 3 天）」「补背单词day1-2」），importance 与 category 沿用原任务，date 选 futureCounts 中第一个 count < 8 的日子。用 deleteTask 删除原任务，用 addTask 创建合并任务。
     · **连续性任务整块迁移**：若同组任务在未来日期（今天及以后）已有安排（如「阅读书籍」在今天及以后已有多天），则将过去未完成任务 moveTask 到未来最后一个同标题任务之后的第一天 count < 8 的日子，保持任务连续不断档；若该日子任务数已满 8，顺延到下一个 count < 8 的日子。
     · **直接迁移**：不属于上述连续性场景的单条普通任务，用 moveTask 移到 futureCounts 中第一个 count < 8 的日子（多任务时记得更新 futureCounts 计数）。
     · 可在同一轮连续调用 moveTask / deleteTask / addTask 工具完成所有迁移。
  3) 用一两句温暖的话与用户说新的一天好。
  4) 调用 getTasks（不传 date，默认今天）查看今天的任务，简要概括今天已安排的任务。
  5) 如有迁移，用一句话总结「已把 X 项过去未完成的任务挪到今天及以后（其中 Y 项合并为 Z 项、整块迁移 W 项、跳过 V 项孤立历史任务）」，不要逐条列举。
  6) 整体回复控制在 180 字以内，语气温暖简洁，不要提及本系统提示，也不要展示工具调用细节。
- 用户说「我完成了 XXX」「XXX 做好了」：先 searchTasks 搜索 XXX，找到匹配任务后调用 toggleTask 标记完成，再简短确认。
- 用户说「明天/后天加一个任务：YYY」：换算日期后调用 addTask（单条也用数组格式），依据返回结果确认。addTask 时务必推断 importance 与 category。
- 用户说「把 XXX 改成 YYY」「删掉 XXX」：先 searchTasks 找到 XXX 的 id 与日期，再 updateTask / deleteTask。
- 用户给出一整段时间的任务清单（如「帮我安排暑假计划，以下是暑假作业的清单：…」）：按上述「任务段安排工作流」执行。
- 用户表达疲惫、压力大、任务太多（如「我累了」「今天任务太多了」「不想干了」「搞不完了」）：
  1) 先共情并给予鼓励；
  2) 主动询问是否愿意把今天部分未完成的任务挪到明天，以减轻今天的负担；
  3) 等待用户确认后再行动——不要未经确认就移动任务；
  4) 用户确认后：调用 getTasks 查看今天未完成项，用 moveTask 批量移到明天；
  5) 移动后总结今天剩余、明天新增，并再次鼓励。
- 用户要查看某天任务，调用 getTasks 后据实复述，给出完成进度；如返回 ≥3 条且分布明显单一，再调用 analyzeTaskBalance 主动提示平衡建议。
- 用户要求生成周报/月报/阶段报，或用户说「生成报告」「出个周报」「总结一下这周/这个月/这个阶段」：
  · 报告生成由界面上的「报告」入口独立处理，不经过你。请引导用户：「报告可以在右上角『报告』入口里直接生成哦」，不要自己尝试生成报告，也不要编造报告内容。
- 用户说「导出/打印/下载任务」「导出任务段」「导出这周/这个月计划」等导出意图：
  1) 换算用户说的时间段为 startDate / endDate（YYYY-MM-DD）。如「这周」=本周一到本周日，「这个月」=本月1号到月末，「暑假」=询问或已知任务段范围。
  2) 若用户提到任务段名称但未给 segmentId，可先调用 getTasks 之外的方式（用户已知 segmentId 时直接用）传入 segmentId。
  3) 调用 exportTasks（startDate、endDate 必填，segmentId 可选）。
  4) 成功：回复中告诉用户已生成 PDF、共多少项任务，并提示「点击下方文件卡片下载」（下载链接会以文件卡片形式展示，用户点击即可下载）。
  5) 失败（返回 error）：如实告知失败原因，不要假装成功，也不要编造链接。
- 用户给的日期或任务信息不足以执行时，先用一句话反问澄清，不要盲目猜测或编造。

记忆系统（两层记忆，帮助你更了解用户）：
你拥有两层记忆，但所有调用都是静默的——绝不在回复中透露「记忆」「核心记忆」「搜索对话」「更新记忆」等内部操作，也不要复述记忆内容本身。回复时就像你天生就记得这些事。
1. 核心记忆：用户偏好 / 性格 / 目标 / 身份等长期信息，以 markdown 形式已注入到你的上下文上方（如为空则尚未建立）。
   · 当用户主动透露新的个人信息（如身份、长期目标、性格特点、习惯偏好、学科专业、作息等）时，主动调用 updateCoreMemory 更新核心记忆。写入时基于现有内容做增量合并，不要丢失已记录的信息。
   · 保持简洁，建议总长度 < 500 字；用清晰的 markdown 小节组织（如 ## 身份 / ## 目标 / ## 偏好）。
   · 不要把核心记忆内容原样念给用户听；它只用于让你的回复更贴合用户。
2. 全部对话：用户与本助手的所有历史消息都已存储。
   · 当用户问及之前讨论过的话题（如「我之前说过我要…」「上次我们聊到的那个…」），调用 searchConversations 用 1-3 个简短关键词搜索，据结果回答。
   · 不要在没有用户回忆意图时主动调用 searchConversations。
3. 重要约束：回复中绝不出现「我已经记住」「我更新了你的核心记忆」「让我搜索一下历史对话」之类的话术。工具调用对用户是不可见的，请保持自然。`;

/**
 * 创建一个绑定到指定用户的 Agent。
 * 工具直接读写数据库（按 userId 隔离），不再依赖客户端传入任务地图。
 * @param userId 当前登录用户 id
 * @param today 客户端今天对应的 YYYY-MM-DD，用于默认日期与"仅今天及以后可改"的校验
 * @param preferences 用户自定义 Agent 配置（角色 / 行为 / 默认模型），可选
 * @param coreMemory 用户核心记忆 markdown，可选；为空字符串或未传则不注入
 * @param now 客户端当前时间的 ISO 字符串，用于注入到 instructions 让模型知道当前日期时间
 */
export function createTaskAgent(
  userId: string,
  today: string,
  preferences?: UserPreferences,
  coreMemory?: string,
  now?: string,
) {
  // YYYY-MM-DD 字符串字典序等价于日期先后
  const isFutureOrToday = (date: string) => date >= today;

  // 选择模型：优先用户配置的默认模型；找不到则回退到内置 deepseek-v4-flash
  const model = resolveModel(preferences);

  // 注入用户自定义 Agent 配置（角色 / 行为）到 instructions
  let instructions = TASKS_INSTRUCTIONS;

  // 注入当前时间，让模型知道现在是什么时候，避免年份/时段判断错误
  if (now) {
    const nowDate = new Date(now);
    const weekday = WEEKDAY_LABELS[(nowDate.getDay() + 6) % 7];
    const hh = String(nowDate.getHours()).padStart(2, "0");
    const mm = String(nowDate.getMinutes()).padStart(2, "0");
    instructions += `\n\n--- 当前时间 ---\n当前时间：${nowDate.getFullYear()}年${nowDate.getMonth() + 1}月${nowDate.getDate()}日 周${weekday} ${hh}:${mm}（${today}）。请始终基于此时间判断年份与时段，不要询问用户"是加到哪一年"之类的问题，也不要在中午/下午说"早上好"。`;
  }

  // 注入迁移模式设定，让 agent 在新一天问候时按用户偏好决策迁移范围
  const behavior = preferences?.agent.behavior;
  const migrationMode = behavior?.migrationMode ?? "important";
  const migrationModeLabel =
    migrationMode === "none"
      ? "不迁移"
      : migrationMode === "all"
        ? "全部迁移"
        : "仅迁移重要任务";
  instructions += `\n\n--- 迁移模式 ---\n用户设定的迁移模式为「${migrationModeLabel}」（migrationMode="${migrationMode}"）。新一天问候迁移过去未完成任务时，按此模式决策：${migrationMode === "none" ? "不迁移任何过去未完成任务。" : migrationMode === "all" ? "迁移所有过去未完成任务。" : '仅迁移重要任务（importance 为"重要且紧急"或"重要但不紧急"的），不重要任务保持原位不迁移。'}`;

  // 注入提问模式设定，控制 agent 在信息模糊时是否主动提问
  const askMode = behavior?.askMode ?? "minimal";
  const askModeLabel =
    askMode === "always"
      ? "总是"
      : askMode === "never"
        ? "绝不"
        : "尽可能不";
  const askModeGuidance =
    askMode === "always"
      ? "存在多种合理理解时，先调用 askQuestions 提问澄清，不要自主猜测。"
      : askMode === "never"
        ? "绝不调用 askQuestions，一律根据上下文/记忆/常识自主决策；信息不足时按最合理方案执行并向用户说明。"
        : "仅在信息缺失会显著影响结果、且无法根据上下文/记忆/常识自主决策时才调用 askQuestions；能自主决策时不要提问。";
  instructions += `\n\n--- 提问模式 ---\n用户设定的提问模式为「${askModeLabel}」（askMode="${askMode}"）。${askModeGuidance}`;

  // 注入用户自定义角色设定
  const role = preferences?.agent.role?.trim();
  if (role) {
    instructions += `\n\n--- 用户自定义 Agent 配置（优先遵循） ---\n\n## 角色设定\n${role}`;
  }

  // 注入用户核心记忆（来自 Vercel Blob Store 的 markdown）
  if (coreMemory && coreMemory.trim().length > 0) {
    instructions += `\n\n--- 用户核心记忆（仅你可读，不要在回复中复述） ---\n${coreMemory.trim()}`;
  }

  return new ToolLoopAgent({
    model,
    instructions,
    // 启用 DeepSeek 思考模式：模型输出推理过程（reasoning parts），
    // 客户端渲染为可折叠的「思考中」区块
    // （仅在模型是内置 deepseek 时生效；自定义模型忽略此选项）
    providerOptions: {
      deepseek: {
        thinking: { type: "enabled" },
      },
    },
    tools: {
      // 客户端工具：无 execute，agent 调用后循环暂停，
      // 由 chat-panel 渲染提问面板收集回答，再通过 addToolOutput 回传结果
      askQuestions: tool({
        description:
          "向用户提问并等待回答。当用户需求模糊、缺失的信息会显著影响最终生成效果、且无法根据上下文/记忆/常识自主决策时调用。一次可提 1-5 个问题，每个问题附 2-6 个候选选项（用户也可自由输入）。用户回答或 3 分钟超时后返回结果；answers 中 answer 为「未回答」、timedOut=true（超时）或 skipped=true（用户跳过）时，按最合理方案自主决策继续，不要再次追问同一问题。能自主决策时不要调用本工具。",
        inputSchema: askQuestionsInputSchema,
      }),
      searchTasks: tool({
        description:
          "按标题关键词搜索任务，无需知道任务 id。可在某天内或全日期范围搜索，返回按相关度排序的匹配结果（含 id、所属日期 date、标题、完成状态）。用于根据用户描述找到对应任务后再操作。",
        inputSchema: z.object({
          query: z.string().describe("搜索关键词，从任务标题中匹配"),
          date: z
            .string()
            .optional()
            .describe("限定在某天内搜索，YYYY-MM-DD，不传则搜索所有日期"),
        }),
        execute: async ({ query, date }) => {
          const byDate = date
            ? { [date]: await taskQueries.loadDay(userId, date) }
            : await taskQueries.loadByDate(userId);

          const norm = (s: string) =>
            s
              .toLowerCase()
              .replace(/[\s,，。、.!?！？:：;；"'""''()（）\-_]/g, "");
          const q = norm(query);
          const qBig = new Set<string>();
          for (let i = 0; i < q.length - 1; i++) qBig.add(q.slice(i, i + 2));

          const results: Array<{
            date: string;
            id: string;
            title: string;
            done: boolean;
            importance: string;
            category: string;
            score: number;
          }> = [];
          for (const [d, list] of Object.entries(byDate)) {
            for (const t of list) {
              const title = norm(t.title);
              let score = 0;
              if (title.includes(q) || q.includes(title)) score += 100;
              let overlap = 0;
              for (let i = 0; i < title.length - 1; i++) {
                if (qBig.has(title.slice(i, i + 2))) overlap++;
              }
              score += overlap;
              if (overlap >= 2 || title.includes(q) || q.includes(title)) {
                results.push({
                  date: d,
                  id: t.id,
                  title: t.title,
                  done: t.done,
                  importance: t.importance,
                  category: t.category,
                  score,
                });
              }
            }
          }
          results.sort((a, b) => b.score - a.score);
          // 只读操作，不返回 tasksByDate，避免覆盖客户端本地状态
          return { results };
        },
      }),
      getTasks: tool({
        description:
          "获取某天的任务列表。不传 date 默认今天。返回该天任务 tasks、所有含任务的日期列表 allDates。仅读取，不修改任务。",
        inputSchema: z.object({
          date: z.string().optional().describe("YYYY-MM-DD，不传则默认今天"),
        }),
        execute: async ({ date }) => {
          const d = date ?? today;
          const tasks = await taskQueries.loadDay(userId, d);
          const all = await taskQueries.loadByDate(userId);
          return {
            date: d,
            tasks,
            allDates: Object.keys(all).sort(),
            today,
          };
        },
      }),
      addTask: tool({
        description:
          "批量新增任务。传入 tasks 数组，每条含 title、importance、category、date?（默认今天）、segmentId?（归属任务段）、tags?（自定义标签数组）、reminderAt?（提醒时间 ISO 字符串）。仅允许今天及以后的日期，过去日期会返回错误。无需先调用 getTasks。",
        inputSchema: z.object({
          tasks: z
            .array(
              z.object({
                title: z.string().describe("任务标题"),
                importance: z
                  .enum([
                    "重要且紧急",
                    "重要但不紧急",
                    "不重要但紧急",
                    "不重要且不紧急",
                  ])
                  .describe(
                    '重要度紧急度四象限："重要且紧急"=立刻做的有截止压力的事；"重要但不紧急"=长期价值可规划的事；"不重要但紧急"=临时打断被动响应；"不重要且不紧急"=碎片放松轻量正向行为',
                  ),
                category: z
                  .enum(["德育", "智育", "体育", "美育", "劳育"])
                  .describe(
                    "五育分类：智育=学习/复习/阅读；体育=微运动/拉伸；德育=善意小事；美育=轻审美体验；劳育=微型劳动",
                  ),
                date: z
                  .string()
                  .optional()
                  .describe("YYYY-MM-DD，不传则默认今天"),
                segmentId: z
                  .string()
                  .optional()
                  .describe("所属任务段 id，不传则不归属任何任务段"),
                tags: z
                  .array(z.string())
                  .optional()
                  .describe(
                    '自定义标签数组（用于分类筛选），如 ["化学","期末"]。不确定时留空',
                  ),
                reminderAt: z
                  .string()
                  .optional()
                  .describe(
                    '提醒时间 ISO 8601 字符串（含时区偏移，如 "2026-07-12T15:00:00+08:00" 表示北京时间下午3点），到点后系统通过浏览器通知提醒。仅对今天及以后的任务有意义',
                  ),
              }),
            )
            .min(1)
            .describe("要创建的任务列表（至少 1 条）"),
        }),
        execute: async ({ tasks }) => {
          // 统一默认日期
          const items = tasks.map((t) => ({ ...t, date: t.date ?? today }));
          // 原子校验：任一日期在过去则整批失败
          for (const t of items) {
            if (!isFutureOrToday(t.date)) {
              return {
                error: `${t.date} 是过去日期，不能修改过去的任务列表`,
                tasksByDate: await taskQueries.loadByDate(userId),
              };
            }
          }
          const created = await taskQueries.insertMany(userId, items);
          return {
            created,
            tasksByDate: await taskQueries.loadByDate(userId),
          };
        },
      }),
      toggleTask: tool({
        description:
          "切换某天指定任务的完成状态（已完成↔未完成）。不传 date 默认今天。仅允许今天及以后的日期。",
        inputSchema: z.object({
          id: z.string().describe("要切换状态的任务 id"),
          date: z.string().optional().describe("YYYY-MM-DD，不传则默认今天"),
        }),
        execute: async ({ id, date }) => {
          const d = date ?? today;
          if (!isFutureOrToday(d)) {
            return {
              error: `${d} 是过去日期，不能修改过去的任务列表`,
              tasksByDate: await taskQueries.loadByDate(userId),
            };
          }
          const existing = await taskQueries.findByIdAndDate(userId, id, d);
          if (!existing) {
            return {
              error: `在 ${d} 未找到 id 为 ${id} 的任务`,
              tasksByDate: await taskQueries.loadByDate(userId),
            };
          }
          const updated = await taskQueries.setDone(userId, id, !existing.done);
          const tasks = await taskQueries.loadDay(userId, d);
          return {
            date: d,
            task: updated,
            tasks,
            tasksByDate: await taskQueries.loadByDate(userId),
          };
        },
      }),
      updateTask: tool({
        description:
          "批量修改任务属性。传入 updates 数组，每条含 id、date?（任务所属日期，默认今天），以及可选的 title / importance / category / tags / reminderAt / segmentId（只需传要改的字段，未传字段保持不变；reminderAt 传 null 表示清除提醒，segmentId 传 null 表示取消关联任务段）。仅允许今天及以后的日期。",
        inputSchema: z.object({
          updates: z
            .array(
              z.object({
                id: z.string().describe("要修改的任务 id"),
                date: z
                  .string()
                  .optional()
                  .describe("任务所属日期 YYYY-MM-DD，不传则默认今天"),
                title: z
                  .string()
                  .optional()
                  .describe("新的任务标题"),
                importance: z
                  .enum([
                    "重要且紧急",
                    "重要但不紧急",
                    "不重要但紧急",
                    "不重要且不紧急",
                  ])
                  .optional()
                  .describe("新的重要度紧急度四象限分类"),
                category: z
                  .enum(["德育", "智育", "体育", "美育", "劳育"])
                  .optional()
                  .describe("新的五育分类"),
                tags: z
                  .array(z.string())
                  .optional()
                  .describe("新的自定义标签数组（整体替换）"),
                reminderAt: z
                  .string()
                  .nullable()
                  .optional()
                  .describe(
                    "新的提醒时间 ISO 字符串；传 null 表示清除提醒",
                  ),
                segmentId: z
                  .string()
                  .nullable()
                  .optional()
                  .describe("新的任务段 id；传 null 表示取消关联任务段"),
              }),
            )
            .min(1)
            .describe("要修改的任务列表"),
        }),
        execute: async ({ updates }) => {
          const results: Array<{
            task: Task | null;
            error?: string;
          }> = [];
          for (const u of updates) {
            const d = u.date ?? today;
            if (!isFutureOrToday(d)) {
              results.push({
                task: null,
                error: `${d} 是过去日期，不能修改过去的任务`,
              });
              continue;
            }
            const existing = await taskQueries.findByIdAndDate(userId, u.id, d);
            if (!existing) {
              results.push({
                task: null,
                error: `在 ${d} 未找到 id 为 ${u.id} 的任务`,
              });
              continue;
            }
            const updated = await taskQueries.updateFields(userId, u.id, {
              title: u.title,
              importance: u.importance,
              category: u.category,
              tags: u.tags,
              reminderAt: u.reminderAt,
              segmentId: u.segmentId,
            });
            results.push({ task: updated });
          }
          return {
            updated: results,
            tasksByDate: await taskQueries.loadByDate(userId),
          };
        },
      }),
      moveTask: tool({
        description:
          "批量移动任务到另一天。传入 moves 数组，每条含 id、to（目标日期）。源日期自动查找，目标日期必须是今天及以后。允许移动过去日期的未完成任务（用于新一天迁移过去未完成任务场景）；过去日期的已完成任务保持只读，不能移动。",
        inputSchema: z.object({
          moves: z
            .array(
              z.object({
                id: z.string().describe("要移动的任务 id"),
                to: z
                  .string()
                  .describe("目标日期 YYYY-MM-DD，必须是今天及以后"),
              }),
            )
            .min(1)
            .describe("要移动的任务列表"),
        }),
        execute: async ({ moves }) => {
          const results: Array<{
            task: Task | null;
            from: string;
            to: string;
            error?: string;
          }> = [];
          for (const m of moves) {
            if (!isFutureOrToday(m.to)) {
              results.push({
                task: null,
                from: "",
                to: m.to,
                error: `${m.to} 是过去日期，不能把任务移动到过去`,
              });
              continue;
            }
            const existing = await taskQueries.findById(userId, m.id);
            if (!existing) {
              results.push({
                task: null,
                from: "",
                to: m.to,
                error: `未找到 id 为 ${m.id} 的任务`,
              });
              continue;
            }
            // 过去日期的已完成任务保持只读（历史记录不可改）
            if (!isFutureOrToday(existing.date) && existing.done) {
              results.push({
                task: null,
                from: existing.date,
                to: m.to,
                error: `任务在 ${existing.date}（过去日期）且已完成，不能移动已完成的历史任务`,
              });
              continue;
            }
            if (existing.date === m.to) {
              results.push({
                task: null,
                from: existing.date,
                to: m.to,
                error: `任务已在 ${m.to}，无需移动`,
              });
              continue;
            }
            const updated = await taskQueries.setDate(userId, m.id, m.to);
            results.push({ task: updated, from: existing.date, to: m.to });
          }
          return {
            moved: results,
            tasksByDate: await taskQueries.loadByDate(userId),
          };
        },
      }),
      deleteTask: tool({
        description:
          "删除某天某条任务。不传 date 默认今天。允许删除过去日期的未完成任务（用于合并迁移场景，如把「背单词day1」「背单词day2」合并为「补背单词day1-2」时删除原任务）；过去日期的已完成任务保持只读，不能删除。",
        inputSchema: z.object({
          id: z.string().describe("要删除的任务 id"),
          date: z.string().optional().describe("YYYY-MM-DD，不传则默认今天"),
        }),
        execute: async ({ id, date }) => {
          const d = date ?? today;
          const existing = await taskQueries.findByIdAndDate(userId, id, d);
          if (!existing) {
            return {
              error: `在 ${d} 未找到 id 为 ${id} 的任务`,
              tasksByDate: await taskQueries.loadByDate(userId),
            };
          }
          // 过去日期的已完成任务保持只读（历史记录不可改）
          if (!isFutureOrToday(d) && existing.done) {
            return {
              error: `${d} 是过去日期且任务已完成，不能删除已完成的历史任务`,
              tasksByDate: await taskQueries.loadByDate(userId),
            };
          }
          const deleted = await taskQueries.remove(userId, id);
          const tasks = await taskQueries.loadDay(userId, d);
          return {
            task: deleted,
            tasks,
            tasksByDate: await taskQueries.loadByDate(userId),
          };
        },
      }),
      analyzeTaskBalance: tool({
        description:
          "分析某天任务的属性分布，检测是否过度集中在单一重要度或单一五育分类，并给出缺失维度的示例任务建议。只读，不修改任务。建议在 addTask 后、或 getTasks 返回 ≥3 条时调用，用于触发平衡提醒。",
        inputSchema: z.object({
          date: z.string().optional().describe("YYYY-MM-DD，不传则默认今天"),
        }),
        execute: async ({ date }) => {
          const d = date ?? today;
          const tasks = await taskQueries.loadDay(userId, d);

          // 统计 importance 与 category 分布
          const impCounts: Record<string, number> = {};
          const catCounts: Record<string, number> = {};
          for (const t of tasks) {
            impCounts[t.importance] = (impCounts[t.importance] ?? 0) + 1;
            catCounts[t.category] = (catCounts[t.category] ?? 0) + 1;
          }

          // 集中度判定：某属性占比 ≥ 80% 视为过度集中
          const threshold = tasks.length * 0.8;
          let concentratedImp: string | null = null;
          let concentratedCat: string | null = null;
          if (tasks.length >= 2) {
            for (const [k, v] of Object.entries(impCounts)) {
              if (v >= threshold) {
                concentratedImp = k;
                break;
              }
            }
            for (const [k, v] of Object.entries(catCounts)) {
              if (v >= threshold) {
                concentratedCat = k;
                break;
              }
            }
          }

          // 缺失维度
          const missingCats = CATEGORY_VALUES.filter((c) => !catCounts[c]);
          const missingImps = IMPORTANCE_VALUES.filter((i) => !impCounts[i]);

          // 每个缺失五育的示例任务标题
          const catExamples: Record<string, string[]> = {
            德育: ["帮家人递东西", "给同学讲题", "主动向邻居问好"],
            智育: ["复习当天笔记 15 分钟", "阅读 30 分钟", "整理错题本"],
            体育: ["5 分钟拉伸", "课间操", "散步 10 分钟"],
            美育: ["听 3 分钟轻音乐", "随手涂鸦", "看一幅风景画"],
            劳育: ["整理书桌", "浇花", "收拾碗筷"],
          };
          const suggestedExamples: Record<string, string[]> = {};
          for (const c of missingCats) {
            suggestedExamples[c] = catExamples[c];
          }

          return {
            date: d,
            total: tasks.length,
            importanceCounts: impCounts,
            categoryCounts: catCounts,
            concentrated: {
              importance: concentratedImp,
              category: concentratedCat,
            },
            missingImportances: missingImps,
            missingCategories: missingCats,
            suggestedExamples:
              Object.keys(suggestedExamples).length > 0
                ? suggestedExamples
                : null,
          };
        },
      }),
      createTaskSegment: tool({
        description:
          "创建任务段。任务段是一段时间范围内的任务归组（如「暑假任务段」），用于分组查看与阶段性报告。时间范围可以相交（多个段覆盖同一天），但不能创建 name+startDate+endDate 完全相同的段。startDate 必须 ≤ endDate。",
        inputSchema: z.object({
          name: z.string().describe("任务段名称，如「暑假任务段」"),
          startDate: z.string().describe("任务段开始日期 YYYY-MM-DD"),
          endDate: z.string().describe("任务段结束日期 YYYY-MM-DD（含当天）"),
          description: z.string().optional().describe("任务段描述（可选）"),
        }),
        execute: async ({ name, startDate, endDate, description }) => {
          if (startDate > endDate) {
            return {
              error: "startDate 必须早于或等于 endDate",
              segments: await segmentQueries.load(userId),
            };
          }
          const result = await segmentQueries.create(userId, {
            name,
            startDate,
            endDate,
            description,
          });
          if ("error" in result) {
            return {
              error: result.error,
              segments: await segmentQueries.load(userId),
            };
          }
          return {
            segment: result,
            segments: await segmentQueries.load(userId),
          };
        },
      }),
      updateTaskSegment: tool({
        description:
          "修改任务段的 name / startDate / endDate / description。只需传入要修改的字段，未传的字段保持不变。",
        inputSchema: z.object({
          id: z.string().describe("要修改的任务段 id"),
          name: z.string().optional().describe("新的任务段名称"),
          startDate: z.string().optional().describe("新的开始日期 YYYY-MM-DD"),
          endDate: z
            .string()
            .optional()
            .describe("新的结束日期 YYYY-MM-DD（含当天）"),
          description: z.string().optional().describe("新的任务段描述"),
        }),
        execute: async ({ id, name, startDate, endDate, description }) => {
          if (startDate && endDate && startDate > endDate) {
            return {
              error: "startDate 必须早于或等于 endDate",
              segments: await segmentQueries.load(userId),
            };
          }
          const existing = await segmentQueries.findById(userId, id);
          if (!existing) {
            return {
              error: `未找到 id 为 ${id} 的任务段`,
              segments: await segmentQueries.load(userId),
            };
          }
          const updated = await segmentQueries.update(userId, id, {
            name,
            startDate,
            endDate,
            description,
          });
          return {
            segment: updated,
            segments: await segmentQueries.load(userId),
          };
        },
      }),
      exportTasks: tool({
        description:
          "导出任务计划为 PDF 文件（含任务表格与打卡框），返回可下载的链接，回复时附上下载链接让用户点击下载。用户说「导出/打印/下载任务」「把任务段导出」「导出这周/这个月的计划」时调用。传入 startDate 和 endDate 指定时间段；若用户提到任务段名称，先用 getTasks 之外的方式（已知 segmentId 时直接传）传入 segmentId，PDF 会以任务段名称作为标题。",
        inputSchema: z.object({
          startDate: z.string().describe("YYYY-MM-DD 起始日期"),
          endDate: z.string().describe("YYYY-MM-DD 结束日期"),
          segmentId: z
            .string()
            .optional()
            .describe("任务段 id，传入则以任务段名称作为 PDF 标题"),
        }),
        execute: async ({ startDate, endDate, segmentId }) => {
          if (startDate > endDate) {
            return { error: "startDate 必须早于或等于 endDate" };
          }
          try {
            const result = await exportTasksToPdf(userId, {
              startDate,
              endDate,
              segmentId,
            });
            return result;
          } catch (e) {
            return {
              error:
                e instanceof Error
                  ? e.message
                  : "导出 PDF 失败（可能 Blob 存储未配置）",
            };
          }
        },
      }),
      getPastIncompleteTasks: tool({
        description:
          "查询过去日期（早于今天）所有未完成任务，返回迁移决策所需的上下文：pastIncomplete（过去未完成任务清单，含 id/title/date/importance/category/segmentId，按日期升序）+ segments（用户全部任务段）+ futureCounts（今天起未来 14 天每日已有任务数）。只读，不执行迁移。新一天问候时先调用此工具，再根据返回结果自主决策迁移方式：直接 moveTask / 合并 deleteTask+addTask / 跳过孤立历史任务。建议单日任务数上限 8 项，超出则顺延到 futureCounts 中下一个 count < 8 的日子。",
        inputSchema: z.object({}).describe("无参数"),
        execute: async () => {
          return await taskQueries.getPastIncompleteData(userId, today);
        },
      }),
      updateCoreMemory: tool({
        description:
          "覆盖更新用户的核心记忆（markdown 格式）。核心记忆保存用户的偏好、性格、目标、身份等长期信息，每个用户只有一份。写入时请基于现有内容做增量合并——保留已有信息、追加或修订新信息，不要丢失已记录的内容。建议总长度 < 500 字，用清晰的 markdown 小节组织（如 ## 身份 / ## 目标 / ## 偏好）。当用户透露新的个人信息时主动调用。",
        inputSchema: z.object({
          content: z
            .string()
            .describe(
              "新的核心记忆完整 markdown 内容（覆盖写入，请确保包含所有应保留的信息）",
            ),
        }),
        execute: async ({ content }) => {
          try {
            await writeCoreMemory(userId, content);
            return { ok: true, content };
          } catch (e) {
            return {
              ok: false,
              error:
                e instanceof Error
                  ? e.message
                  : "写入核心记忆失败（Blob Store 未配置或不可用）",
            };
          }
        },
      }),
      searchConversations: tool({
        description:
          "用简短关键词搜索本用户的历史对话消息。返回匹配的消息片段（含角色、文本、日期）。当用户回忆之前讨论过的话题、或需要确认曾经说过的偏好/计划时调用。每次用 1-3 个精炼关键词，避免整句搜索。",
        inputSchema: z.object({
          keywords: z
            .array(z.string())
            .min(1)
            .max(5)
            .describe("1-5 个简短搜索关键词，做包含匹配"),
        }),
        execute: async ({ keywords }) => {
          const results = await conversationQueries.search(userId, keywords);
          return {
            keywords,
            count: results.length,
            results,
          };
        },
      }),
    },
  });
}

/**
 * 根据用户偏好选择 LanguageModel。
 * - preferences 为空或 defaultModelId 为空 → 内置 deepseek-v4-flash
 * - defaultModelId 指向用户配置列表中的某个模型 → 用 CustomLanguageModel
 * - defaultModelId 找不到对应配置 → 回退到 deepseek-v4-flash
 */
function resolveModel(preferences?: UserPreferences): LanguageModelV4 {
  const defaultId = preferences?.models?.defaultModelId;
  if (!defaultId) {
    return deepseek("deepseek-v4-flash") as unknown as LanguageModelV4;
  }
  const config = preferences ? findModelConfig(preferences, defaultId) : null;
  if (!config) {
    return deepseek("deepseek-v4-flash") as unknown as LanguageModelV4;
  }
  return createCustomLanguageModel(config);
}
