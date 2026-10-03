import {
  listMaintenanceRecords,
  listRechecks,
  saveMaintenanceRecords,
  saveRechecks,
} from '@/data/ledger-store'
import { listRows, saveRows } from '@/data/local-store'
import { moduleMeta } from './local-service'
import type { ActionResult, EntryRow, MaintenanceRecord, RecheckItem } from '@/data/types'

const BREAKER_KEY = 'breaker'
// 操作次数机械寿命上限：超过就标异常并挡回，具体阈值集中在这里。
export const MAX_OPERATION_COUNT = 10000

export type MaintenanceSubmit = {
  breakerId: number
  保养日期: string
  操作次数: number
  储能时间?: string
  保养周期?: string
}

export type DueReminder = {
  breaker: EntryRow
  lastDate: string
  cycleMonths: number
  dueDate: string
  overdueDays: number
  neverMaintained: boolean
}

export type PendingMaintItem = {
  breaker: EntryRow
  kind: 'due' | 'missingCycle'
  reminder: DueReminder | null
}

export type BreakerStats = {
  running: number
  pending: number
  repair: number
}

function breakers(): EntryRow[] {
  return listRows(BREAKER_KEY)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

/** 字段是否未登记；列表里缺一格也不能把整行拖垮。 */
export function fieldMissing(row: EntryRow, field: string): boolean {
  return isBlank(row[field])
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

/** 解析 YYYY-MM-DD；登记不规范的日期一律视为没有，不再让整屏列表取不出来。 */
export function parseDate(value: unknown): Date | null {
  if (isBlank(value)) {
    return null
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim())
  if (!match) {
    return null
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null
  }
  return date
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(date)
  const day = target.getDate()
  target.setMonth(target.getMonth() + months)
  // 2 月底这类没有 31 号的月份，顺延会多跑一个月，回拉到当月最后一天。
  if (target.getDate() < day) {
    target.setDate(0)
  }
  return target
}

function wholeDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86400000)
}

/**
 * 保养周期口径：数字按「月」计，带「年」字换算成 12 个月；
 * 空着或认不出来的返回 null，由待保养栏点明缺周期，不进到期提醒。
 */
export function parseCycleMonths(value: unknown): number | null {
  if (isBlank(value)) {
    return null
  }
  const text = String(value).trim()
  const match = /^(\d+(?:\.\d+)?)\s*(年|月)?$/.exec(text)
  if (!match) {
    return null
  }
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }
  return match[2] === '年' ? amount * 12 : amount
}

/** 操作次数：非数字/空返回 null，是否超上限由调用方判定。 */
export function parseOperationCount(value: unknown): number | null {
  if (isBlank(value)) {
    return null
  }
  const parsed = Number(String(value).trim())
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

export function operationCountExceeded(row: EntryRow): boolean {
  const count = parseOperationCount(row['操作次数'])
  return count !== null && count > MAX_OPERATION_COUNT
}

function recordsFor(breakerId: number): MaintenanceRecord[] {
  return listMaintenanceRecords()
    .filter((record) => record.breakerId === breakerId)
    .sort((a, b) => (a.保养日期 < b.保养日期 ? 1 : a.保养日期 > b.保养日期 ? -1 : 0))
}

/**
 * 上次保养日的唯一口径：列表页和详情页都走这里。
 * 有保养记录时以最近一次保养记录为准，台账行里的旧值与之冲突也让位；没有记录才沿用台账行。
 */
export function resolveLastMaintenanceDate(row: EntryRow): string {
  const latest = recordsFor(Number(row.id))[0]
  if (latest) {
    return latest.保养日期
  }
  return isBlank(row['上次保养日']) ? '' : String(row['上次保养日'])
}

function toReminder(breaker: EntryRow): DueReminder | null {
  if (String(breaker.status) === '需检修') {
    return null
  }
  const cycleMonths = parseCycleMonths(breaker['保养周期'])
  if (cycleMonths === null) {
    return null
  }
  const lastText = resolveLastMaintenanceDate(breaker)
  const lastDate = parseDate(lastText)
  const today = new Date()
  if (!lastDate) {
    // 从没保养过：保养周期在却没有任何保养日，直接算到期。
    return {
      breaker,
      lastDate: '',
      cycleMonths,
      dueDate: '',
      overdueDays: 0,
      neverMaintained: true,
    }
  }
  const dueDate = addMonths(lastDate, cycleMonths)
  const overdueDays = wholeDaysBetween(dueDate, today)
  if (overdueDays < 0) {
    return null
  }
  return {
    breaker,
    lastDate: toISODate(lastDate),
    cycleMonths,
    dueDate: toISODate(dueDate),
    overdueDays,
    neverMaintained: false,
  }
}

/** 保养提醒：周期齐全、确实到期（含逾期）的设备；缺周期的一律不进来。 */
export function listDueReminders(): DueReminder[] {
  const reminders = breakers()
    .map(toReminder)
    .filter((item): item is DueReminder => item !== null)
  return reminders.sort((a, b) => b.overdueDays - a.overdueDays)
}

/**
 * 待保养栏：真到期的（到期提醒）+ 周期没登记无法判断的（点明缺周期）。
 * 已得出「需检修」结论的设备在巡视复查清单里跟踪，不再占保养位。
 */
export function listPendingMaintenance(): PendingMaintItem[] {
  const due = listDueReminders()
  const items: PendingMaintItem[] = due.map((reminder) => ({
    breaker: reminder.breaker,
    kind: 'due',
    reminder,
  }))
  for (const breaker of breakers()) {
    if (String(breaker.status) === '需检修') {
      continue
    }
    if (parseCycleMonths(breaker['保养周期']) === null && !due.some((item) => item.breaker.id === breaker.id)) {
      items.push({ breaker, kind: 'missingCycle', reminder: null })
    }
  }
  return items
}

export function getBreakerStats(): BreakerStats {
  const rows = breakers()
  return {
    running: rows.filter((row) => String(row.status) === '运行中').length,
    pending: listDueReminders().length,
    repair: rows.filter((row) => String(row.status) === '需检修').length,
  }
}

function nextRecordId(): number {
  const ids = listMaintenanceRecords().map((record) => record.id)
  return (ids.length ? Math.max(...ids) : 0) + 1
}

function persistBreaker(updated: EntryRow): EntryRow[] {
  const rows = breakers()
  const index = rows.findIndex((row) => Number(row.id) === Number(updated.id))
  const next = [...rows]
  if (index >= 0) {
    next[index] = updated
  } else {
    next.push(updated)
  }
  saveRows(BREAKER_KEY, next)
  return next
}

function dropRecheck(breakerId: number): void {
  const remaining = listRechecks().filter((item) => item.breakerId !== breakerId)
  if (remaining.length !== listRechecks().length) {
    saveRechecks(remaining)
  }
}

/**
 * 提交保养：
 * - 同一台设备同一保养日重复提交，只保留既有那条，不再新增；
 * - 操作次数超过上限：标成异常并挡回，保养不入库；
 * - 通过后写保养记录、更新台账，上次保养日以最近记录为准；
 * - 之前「需检修」的设备保养完成后，同步撤出巡视待复查清单。
 */
export function submitMaintenance(payload: MaintenanceSubmit): ActionResult {
  const meta = moduleMeta(BREAKER_KEY)
  const rows = breakers()
  const index = rows.findIndex((row) => Number(row.id) === payload.breakerId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${payload.breakerId} 的${meta.entity}` }
  }
  if (!parseDate(payload.保养日期)) {
    return { ok: false, message: '请填写有效的保养日期' }
  }
  if (!Number.isInteger(payload.操作次数) || payload.操作次数 < 0) {
    return { ok: false, message: '操作次数需为不小于 0 的整数' }
  }

  const breaker = rows[index]
  if (payload.操作次数 > MAX_OPERATION_COUNT) {
    persistBreaker({ ...breaker, abnormal: true })
    return {
      ok: false,
      message: `操作次数 ${payload.操作次数} 次已超过上限 ${MAX_OPERATION_COUNT} 次，已标记异常，保养未保存`,
    }
  }

  const records = listMaintenanceRecords()
  const existing = records.find(
    (record) =>
      record.breakerId === payload.breakerId && record.保养日期 === payload.保养日期,
  )
  if (existing) {
    return { ok: true, message: `${String(breaker['设备编号'])} 在 ${payload.保养日期} 已有保养记录，未重复登记` }
  }

  const record: MaintenanceRecord = {
    id: nextRecordId(),
    breakerId: payload.breakerId,
    保养日期: payload.保养日期,
    操作次数: payload.操作次数,
    储能时间: payload.储能时间 ?? '',
    保养周期: payload.保养周期 ?? String(breaker['保养周期'] ?? ''),
    createdAt: new Date().toISOString(),
  }
  saveMaintenanceRecords([...records, record])

  const updated: EntryRow = {
    ...breaker,
    操作次数: payload.操作次数,
    上次保养日: payload.保养日期,
    设备状态: breaker['设备状态'],
    status: '已保养',
    pending: false,
    abnormal: false,
  }
  if (payload.储能时间 && payload.储能时间.trim() !== '') {
    updated['储能时间'] = payload.储能时间
  }
  if (payload.保养周期 && payload.保养周期.trim() !== '') {
    updated['保养周期'] = payload.保养周期
  }
  persistBreaker(updated)
  dropRecheck(payload.breakerId)
  return { ok: true, message: `${String(breaker['设备编号'])} 保养已登记，上次保养日 ${payload.保养日期}` }
}

function upsertRecheck(breaker: EntryRow): void {
  const items = listRechecks()
  const item: RecheckItem = {
    breakerId: Number(breaker.id),
    设备编号: String(breaker['设备编号'] ?? ''),
    所属间隔: String(breaker['所属间隔'] ?? ''),
    结论: '需检修',
    提出时间: todayISO(),
    来源: '断路器维护',
  }
  const index = items.findIndex((row) => row.breakerId === item.breakerId)
  const next = [...items]
  if (index >= 0) {
    next[index] = { ...items[index], ...item }
  } else {
    next.push(item)
  }
  saveRechecks(next)
}

/** 提出检修：状态转「需检修」，并把结论同步到设备巡视的待复查清单（同设备只留一条）。 */
export function requestInspection(breakerId: number): ActionResult {
  const meta = moduleMeta(BREAKER_KEY)
  const rows = breakers()
  const index = rows.findIndex((row) => Number(row.id) === breakerId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${breakerId} 的${meta.entity}` }
  }
  const breaker = rows[index]
  if (String(breaker.status) === '需检修') {
    upsertRecheck(breaker)
    return { ok: false, message: `${meta.entity}已经是「需检修」，结论已在巡视待复查清单中` }
  }
  persistBreaker({ ...breaker, status: '需检修', pending: false, abnormal: false })
  upsertRecheck({ ...breaker, status: '需检修' })
  return { ok: true, message: `${String(breaker['设备编号'])} 已提出检修，结论同步至设备巡视待复查清单` }
}

/** 登记运行：恢复运行的设备同步撤出巡视待复查清单。 */
export function registerRunning(breakerId: number): ActionResult {
  const meta = moduleMeta(BREAKER_KEY)
  const rows = breakers()
  const index = rows.findIndex((row) => Number(row.id) === breakerId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${breakerId} 的${meta.entity}` }
  }
  const breaker = rows[index]
  if (String(breaker.status) === '运行中') {
    return { ok: false, message: `${meta.entity}已经是「运行中」，不用重复操作` }
  }
  persistBreaker({ ...breaker, status: '运行中', pending: true, abnormal: false })
  dropRecheck(breakerId)
  return { ok: true, message: `${String(breaker['设备编号'])} 已登记运行` }
}

export function getBreaker(breakerId: number): EntryRow | null {
  return breakers().find((row) => Number(row.id) === breakerId) ?? null
}

export function listBreakerMaintenance(breakerId: number): MaintenanceRecord[] {
  return recordsFor(breakerId)
}

/**
 * 设备巡视侧的待复查清单：台账里登记过的「需检修」结论，按设备去重；
 * 设备已不在需检修状态的不再列出（保养完成/恢复运行时会同步撤出）。
 */
export function listPendingRechecks(): RecheckItem[] {
  const rows = breakers()
  return listRechecks()
    .filter((item) => {
      const breaker = rows.find((row) => Number(row.id) === item.breakerId)
      return breaker && String(breaker.status) === '需检修'
    })
    .sort((a, b) => (a.提出时间 < b.提出时间 ? 1 : a.提出时间 > b.提出时间 ? -1 : 0))
}
