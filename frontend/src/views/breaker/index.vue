<template>
  <section class="page" data-module="breaker">
    <header class="page-head">
      <div>
        <h2>断路器维护管理</h2>
        <p class="page-desc">维护断路器，围绕设备编号、所属间隔、断路器型号、操作次数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记断路器</button>
        <button class="btn" type="button" @click="exportRows">导出断路器维护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 保养提醒：只有周期登记齐全且确实到期的才响；缺周期的不进这里。 -->
    <section class="panel">
      <h3 class="panel-title">保养提醒（{{ dueReminders.length }}）</h3>
      <ul v-if="dueReminders.length" class="reminder-list">
        <li v-for="item in dueReminders" :key="item.breaker.id" class="reminder-item">
          <RouterLink class="link" :to="`/breaker/${item.breaker.id}`">
            {{ String(item.breaker['设备编号']) }}
          </RouterLink>
          <span class="muted">{{ String(item.breaker['所属间隔']) }}</span>
          <span v-if="item.neverMaintained" class="tag warn">从未保养，尽快安排</span>
          <span v-else :class="['tag', item.overdueDays > 0 ? 'danger' : 'warn']">
            应于 {{ item.dueDate }} 前保养{{ item.overdueDays > 0 ? `，已逾期 ${item.overdueDays} 天` : '，今日到期' }}
          </span>
          <button class="link" type="button" @click="openMaint(item.breaker)">登记保养</button>
        </li>
      </ul>
      <p v-else class="panel-empty">暂无到期保养；未登记保养周期的设备请在下方待保养栏补登。</p>
    </section>

    <!-- 待保养栏：真到期的 + 周期没登记的（点明缺周期）。 -->
    <section class="panel">
      <h3 class="panel-title">待保养（{{ pendingItems.length }}）</h3>
      <ul v-if="pendingItems.length" class="pending-list">
        <li v-for="item in pendingItems" :key="item.breaker.id" class="pending-item">
          <RouterLink class="link" :to="`/breaker/${item.breaker.id}`">
            {{ String(item.breaker['设备编号']) }}
          </RouterLink>
          <span class="muted">{{ String(item.breaker['所属间隔']) }}</span>
          <span v-if="item.kind === 'missingCycle'" class="tag missing">缺保养周期，无法计算到期日，请补登周期</span>
          <span v-else-if="item.reminder?.neverMaintained" class="tag warn">待保养 · 从未保养</span>
          <span v-else-if="item.reminder" class="tag warn">
            待保养 · {{ item.reminder.overdueDays > 0 ? `已逾期 ${item.reminder.overdueDays} 天` : '今日到期' }}
          </span>
          <button class="link" type="button" @click="openMaint(item.breaker)">登记保养</button>
        </li>
      </ul>
      <p v-else class="panel-empty">暂无需保养的断路器。</p>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': isAbnormal(row) }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '设备编号'">
              <RouterLink class="link" :to="`/breaker/${row.id}`">{{ cellText(row, column) }}</RouterLink>
            </template>
            <template v-else-if="column === '操作次数' && countExceeded(row)">
              {{ cellText(row, column) }}
              <span class="tag danger">异常：超上限 {{ MAX_OPERATION_COUNT }}</span>
            </template>
            <template v-else>
              <span>{{ cellText(row, column) }}</span>
              <span v-if="missingFields.includes(column) && fieldMissing(row, column)" class="missing-inline">
                缺{{ column }}
              </span>
            </template>
          </td>
          <td>
            {{ row.status }}
            <span v-if="isAbnormal(row)" class="tag danger">异常</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="runAction('登记运行', row)">登记运行</button>
            <button class="link" type="button" @click="openMaint(row)">完成保养</button>
            <button class="link" type="button" @click="runAction('提出检修', row)">提出检修</button>
          </td>
        </tr>
        <!-- 读失败：给出错误空态并允许重试，不再误导成「暂无数据」 -->
        <tr v-if="loadFailed">
          <td :colspan="columns.length + 2" class="empty-state error-state">
            <p>断路器维护列表读取失败：{{ errorMessage }}</p>
            <button class="btn" type="button" @click="reload">重试</button>
          </td>
        </tr>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无断路器维护数据，可先登记断路器</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条断路器维护记录</span>
      <span v-if="notice" :class="notice.ok ? 'success-text' : 'error-text'">{{ notice.text }}</span>
    </footer>

    <MaintenanceDialog :breaker="dialogBreaker" @cancel="dialogBreaker = null" @done="onMaintDone" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  fieldMissing,
  getBreakerStats,
  listDueReminders,
  listPendingMaintenance,
  MAX_OPERATION_COUNT,
  operationCountExceeded,
  registerRunning,
  requestInspection,
  resolveLastMaintenanceDate,
} from '@/api/breaker-service'
import type { DueReminder, PendingMaintItem } from '@/api/breaker-service'
import type { EntryRow } from '@/data/types'
import MaintenanceDialog from './MaintenanceDialog.vue'

const meta = moduleMeta('breaker')
const columns = ['设备编号', '所属间隔', '断路器型号', '操作次数', '储能时间', '保养周期', '上次保养日', '设备状态']
// 这两格缺一项不影响整行展示，缺哪格就在行内点明。
const missingFields = ['操作次数', '储能时间']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const loadFailed = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const dialogBreaker = ref<EntryRow | null>(null)

const stats = ref([
  { label: '运行中断路器', value: 0 },
  { label: '待保养断路器', value: 0 },
  { label: '需检修断路器', value: 0 },
])
const dueReminders = ref<DueReminder[]>([])
const pendingItems = ref<PendingMaintItem[]>([])

const statuses = ['待保养', '运行中', '已保养', '需检修']
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isAbnormal(row: EntryRow): boolean {
  return Boolean(row.abnormal) || operationCountExceeded(row)
}

function countExceeded(row: EntryRow): boolean {
  return operationCountExceeded(row)
}

// 上次保养日：列表与详情走同一口径（最近一次保养记录优先），不在这里各算各的。
function cellText(row: EntryRow, column: string): string {
  if (column === '上次保养日') {
    return resolveLastMaintenanceDate(row)
  }
  const value = row[column]
  return value === undefined || value === null || String(value) === '' ? '—' : String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  notice.value = { ok: false, text: '断路器登记入口尚未接入审批流' }
}

function openMaint(row: EntryRow) {
  notice.value = null
  dialogBreaker.value = row
}

function onMaintDone(message: string) {
  // 弹窗内部对失败（如超上限）有行内提示，这里只在成功后关闭并刷新。
  const ok = !message.includes('未保存')
  if (ok) {
    dialogBreaker.value = null
  }
  notice.value = { ok, text: message }
  reload()
}

function runAction(action: string, row: EntryRow) {
  notice.value = null
  const result =
    action === '登记运行'
      ? registerRunning(Number(row.id))
      : action === '提出检修'
        ? requestInspection(Number(row.id))
        : { ok: false, message: '请通过保养登记完成保养' }
  notice.value = { ok: result.ok, text: result.message }
  reload()
}

function refreshPanels() {
  const summary = getBreakerStats()
  stats.value = [
    { label: '运行中断路器', value: summary.running },
    { label: '待保养断路器', value: summary.pending },
    { label: '需检修断路器', value: summary.repair },
  ]
  dueReminders.value = listDueReminders()
  pendingItems.value = listPendingMaintenance()
}

function reload() {
  errorMessage.value = ''
  notice.value = null
  try {
    // 数据层抛错（如本地台账损坏）时也要兜住：列表进入错误空态并允许重试。
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadFailed.value = false
    refreshPanels()
  } catch (error) {
    rows.value = []
    total.value = 0
    loadFailed.value = true
    errorMessage.value = error instanceof Error ? error.message : '断路器维护列表读取失败'
  }
}

onMounted(reload)
</script>
