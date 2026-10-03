import { LEDGER_SEED } from './seed'
import type { LedgerData, MaintenanceRecord, RecheckItem } from './types'

// 断路器配套台账：保养记录、巡视待复查项单独存放，不混进模块行数据。
const LEDGER_KEY = 'substation-protection:breaker-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readLedger(): LedgerData {
  const fallback = clone(LEDGER_SEED)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(LEDGER_KEY)
  if (!raw) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LedgerData>
    return {
      maintenance: Array.isArray(parsed.maintenance) ? parsed.maintenance : clone(fallback.maintenance),
      rechecks: Array.isArray(parsed.rechecks) ? parsed.rechecks : clone(fallback.rechecks),
    }
  } catch {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: LedgerData | null = null

export function ledger(): LedgerData {
  if (cache === null) {
    cache = readLedger()
  }
  return cache
}

export function listMaintenanceRecords(): MaintenanceRecord[] {
  return ledger().maintenance
}

export function saveMaintenanceRecords(records: MaintenanceRecord[]): void {
  persist({ maintenance: records })
}

export function listRechecks(): RecheckItem[] {
  return ledger().rechecks
}

export function saveRechecks(items: RecheckItem[]): void {
  persist({ rechecks: items })
}

export function resetLedger(): LedgerData {
  cache = clone(LEDGER_SEED)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(cache))
  }
  return cache
}

export function ledgerStorageKey(): string {
  return LEDGER_KEY
}

function persist(patch: Partial<LedgerData>): void {
  const next = { ...ledger(), ...patch }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  }
}
