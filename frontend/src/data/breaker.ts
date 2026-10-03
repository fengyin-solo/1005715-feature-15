import { listRows, saveRows } from './local-store'
import type { ActionResult, EntryRow } from './types'

// 断路器保养口径：列表页与详情页共用这一份，周期、到期、上次保养日的算法不允许两处各写一套。
export const BREAKER_KEY = 'breaker'
export const OPERATION_LIMIT = 10000

// 保养记录单独存一份：同一台设备无论提交几次，只保留最近一条。
const LOG_STORAGE_KEY = 'substation-protection:breaker-maintenance'
const DAY_MS = 24 * 60 * 60 * 1000

export type BreakerMaintenanceLog = {
  id: number
  设备编号: string
  date: string
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

export function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDate(value: unknown): Date | null {
  if (isBlank(value)) {
    return null
  }
  const text = String(value).trim()
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (!matched) {
    return null
  }
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

// 保养周期支持「180天 / 3个月 / 1年 / 纯天数」几种既有登记口径，解析不出按缺周期处理。
export function parseCycleDays(value: unknown): number | null {
  if (isBlank(value)) {
    return null
  }
  const text = String(value).trim()
  const matched = /^(\d+(?:\.\d+)?)\s*(天|日|个月|月|年)?$/.exec(text)
  if (!matched) {
    return null
  }
  const amount = Number(matched[1])
  const unit = matched[2] ?? '天'
  if (unit === '年') {
    return Math.round(amount * 365)
  }
  if (unit === '个月' || unit === '月') {
    return Math.round(amount * 30)
  }
  return Math.round(amount)
}

export function parseOperationCount(value: unknown): number | null {
  if (isBlank(value)) {
    return null
  }
  const matched = /^-?\d+/.exec(String(value).trim())
  if (!matched) {
    return null
  }
  return Number(matched[0])
}

export function isOverOperationLimit(row: EntryRow): boolean {
  const count = parseOperationCount(row['操作次数'])
  return count !== null && count > OPERATION_LIMIT
}

export function missingFields(row: EntryRow): { cycle: boolean; chargeTime: boolean; operations: boolean } {
  return {
    cycle: parseCycleDays(row['保养周期']) === null,
    chargeTime: isBlank(row['储能时间']),
    operations: parseOperationCount(row['操作次数']) === null,
  }
}

function loadLogs(): Record<number, BreakerMaintenanceLog> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<number, BreakerMaintenanceLog>) : {}
  } catch {
    return {}
  }
}

function persistLogs(logs: Record<number, BreakerMaintenanceLog>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs))
  }
}

export function maintenanceLogOf(id: number): BreakerMaintenanceLog | null {
  return loadLogs()[id] ?? null
}

// 既有保养口径取台账里的「上次保养日」；与实际保养记录冲突时，以最近一次保养记录为准。
// 列表页和详情页都走这个函数，保证两处显示一致。
export function lastMaintenanceDate(row: EntryRow): string {
  const fieldDate = parseDate(row['上次保养日'])
  const logDate = parseDate(maintenanceLogOf(Number(row.id))?.date)
  if (fieldDate && logDate) {
    return toISODate(logDate.getTime() > fieldDate.getTime() ? logDate : fieldDate)
  }
  const chosen = logDate ?? fieldDate
  return chosen ? toISODate(chosen) : ''
}

export function isMaintenanceDue(row: EntryRow, today: Date = new Date()): boolean {
  const cycleDays = parseCycleDays(row['保养周期'])
  const lastDate = parseDate(lastMaintenanceDate(row))
  // 周期为空的不进提醒：没法判断到期，交给待保养栏点明「缺周期」。
  if (cycleDays === null || !lastDate) {
    return false
  }
  const elapsed = Math.floor((today.getTime() - lastDate.getTime()) / DAY_MS)
  return elapsed >= cycleDays
}

export function overdueDays(row: EntryRow, today: Date = new Date()): number {
  const cycleDays = parseCycleDays(row['保养周期'])
  const lastDate = parseDate(lastMaintenanceDate(row))
  if (cycleDays === null || !lastDate) {
    return 0
  }
  return Math.floor((today.getTime() - lastDate.getTime()) / DAY_MS) - cycleDays
}

export function listBreakers(): EntryRow[] {
  return listRows(BREAKER_KEY)
}

export function dueBreakers(today: Date = new Date()): EntryRow[] {
  return listBreakers().filter((row) => isMaintenanceDue(row, today))
}

// 需检修的断路器要反映到设备巡视那边的待复查清单。
export function reviewPendingBreakers(): EntryRow[] {
  return listBreakers().filter((row) => String(row.status) === '需检修')
}

// 完成保养：超上限的先标异常并挡回，保存不落地；正常提交则更新上次保养日，
// 并按设备编号写入唯一一条保养记录，重复提交只覆盖、不留多条。
export function completeBreakerMaintenance(id: number, today: Date = new Date()): ActionResult {
  const rows = listBreakers()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的断路器` }
  }
  const current = rows[index]
  if (isOverOperationLimit(current)) {
    const flagged: EntryRow = { ...current, abnormal: true }
    const next = [...rows]
    next[index] = flagged
    saveRows(BREAKER_KEY, next)
    return {
      ok: false,
      message: `${current['设备编号']} 操作次数 ${current['操作次数']} 已超过上限 ${OPERATION_LIMIT}，已标记异常，保养已挡回，请先检修核实`,
    }
  }

  const date = toISODate(today)
  const updated: EntryRow = {
    ...current,
    status: '已保养',
    pending: false,
    abnormal: false,
    上次保养日: date,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(BREAKER_KEY, next)

  const logs = loadLogs()
  logs[id] = { id, 设备编号: String(updated['设备编号'] ?? ''), date }
  persistLogs(logs)

  const repeated = String(current.status) === '已保养'
  return {
    ok: true,
    message: repeated
      ? `${updated['设备编号']} 保养已重复提交，仍只保留最近一条保养记录（${date}）`
      : `${updated['设备编号']} 已完成保养，上次保养日记为 ${date}`,
  }
}
