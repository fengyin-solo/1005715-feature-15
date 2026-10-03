/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 断路器保养记录：同一台设备同一保养日只保留一条，列表与详情页的「上次保养日」都以它为准。
export type MaintenanceRecord = {
  id: number
  breakerId: number
  保养日期: string
  操作次数: number
  储能时间: string
  保养周期: string
  createdAt: string
}

// 设备巡视的待复查清单项：由断路器「需检修」结论同步过来，按设备去重。
export type RecheckItem = {
  breakerId: number
  设备编号: string
  所属间隔: string
  结论: string
  提出时间: string
  来源: string
}

// 断路器配套台账：保养记录与待复查项，独立于模块行数据持久化。
export type LedgerData = {
  maintenance: MaintenanceRecord[]
  rechecks: RecheckItem[]
}
