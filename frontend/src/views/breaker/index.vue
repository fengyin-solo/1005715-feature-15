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

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="reminder-panel">
      <h3 class="reminder-title">保养提醒（到期即保养，共 {{ dueRows.length }} 台）</h3>
      <p v-if="dueLoadFailed" class="reminder-empty error-text">
        保养提醒读取失败：{{ errorMessage || '数据暂不可用' }}
        <button class="btn" type="button" @click="reload">重试</button>
      </p>
      <p v-else-if="!dueRows.length" class="reminder-empty">当前没有按保养周期到期的断路器；周期未登记的不在提醒范围内，请到下方列表补登周期。</p>
      <ul v-else class="reminder-list">
        <li v-for="row in dueRows" :key="String(row.id)">
          <RouterLink class="link" :to="`/breaker/${row.id}`">{{ row['设备编号'] }}</RouterLink>
          <span class="reminder-meta">{{ row['所属间隔'] }} · 上次保养日 {{ displayValue(row, '上次保养日') }} · 周期 {{ row['保养周期'] }}</span>
          <span v-if="overdueDays(row) > 0" class="tag tag-warn">已超期 {{ overdueDays(row) }} 天</span>
          <span v-else class="tag">今日到期</span>
        </li>
      </ul>
    </section>

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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal || isOverLimit(row) }">
          <td v-for="column in columns" :key="column" :class="cellClass(row, column)">
            {{ displayValue(row, column) }}
            <span v-if="column === '保养周期' && missing(row).cycle" class="cell-note">缺周期</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal || isOverLimit(row)" class="tag tag-danger">异常</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/breaker/${row.id}`">查看详情</RouterLink>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="loadFailed">
          <td :colspan="columns.length + 2" class="empty-state">
            <p class="error-text">断路器维护列表读取失败：{{ errorMessage || '数据暂不可用' }}</p>
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
      <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  dueBreakers,
  isMaintenanceDue,
  isOverOperationLimit,
  lastMaintenanceDate,
  missingFields,
  overdueDays as calcOverdueDays,
} from '@/data/breaker'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('breaker')
const columns = ['设备编号', '所属间隔', '断路器型号', '操作次数', '储能时间', '保养周期', '上次保养日', '设备状态']
const actions = ['登记运行', '完成保养', '提出检修']
const statuses = ['待保养', '运行中', '已保养', '需检修']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const actionMessage = ref('')
const actionOk = ref(false)
const loadFailed = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const dueRows = ref<EntryRow[]>([])
const dueLoadFailed = ref(false)

const stats = computed(() => [
  { label: '运行中断路器', value: rows.value.filter((row) => String(row.status) === '运行中').length },
  { label: '待保养断路器', value: rows.value.filter((row) => String(row.status) === '待保养').length },
  { label: '需检修断路器', value: rows.value.filter((row) => String(row.status) === '需检修').length },
  { label: '到期应保养', value: dueRows.value.length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function missing(row: EntryRow) {
  return missingFields(row)
}

function isOverLimit(row: EntryRow): boolean {
  return isOverOperationLimit(row)
}

function overdueDays(row: EntryRow): number {
  return calcOverdueDays(row)
}

// 缺哪一格就在行内写明；上次保养日统一走保养口径，与详情页保持一致。
function displayValue(row: EntryRow, column: string): string {
  const value = row[column]
  if (column === '操作次数') {
    if (missing(row).operations) {
      return '未登记操作次数'
    }
    return String(value)
  }
  if (column === '储能时间') {
    return missing(row).chargeTime ? '未登记储能时间' : String(value)
  }
  if (column === '上次保养日') {
    return lastMaintenanceDate(row) || '未保养'
  }
  if (column === '保养周期') {
    const text = value === undefined || value === null || String(value).trim() === '' ? '' : String(value)
    return text
  }
  return value === undefined || value === null || String(value) === '' ? '—' : String(value)
}

function cellClass(row: EntryRow, column: string): Record<string, boolean> {
  const miss = missing(row)
  return {
    'cell-missing':
      (column === '操作次数' && miss.operations) ||
      (column === '储能时间' && miss.chargeTime) ||
      (column === '上次保养日' && !lastMaintenanceDate(row)),
    'cell-danger': column === '操作次数' && isOverLimit(row),
    'cell-warn': column === '保养周期' && miss.cycle,
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  actionOk.value = false
  actionMessage.value = '断路器登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  actionMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  actionOk.value = result.ok
  actionMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  loadFailed.value = false
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    loadFailed.value = true
    rows.value = []
    total.value = 0
    errorMessage.value = error instanceof Error ? error.message : '断路器维护列表读取失败'
  }
  // 提醒栏不受筛选条件影响，始终给出全量到期清单，不用自己数。
  dueLoadFailed.value = false
  try {
    dueRows.value = dueBreakers().filter((row) => isMaintenanceDue(row))
  } catch (error) {
    dueLoadFailed.value = true
    dueRows.value = []
    errorMessage.value = error instanceof Error ? error.message : '保养提醒读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.reminder-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid var(--brand);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.reminder-title { margin: 0 0 8px; font-size: 14px; }
.reminder-empty { margin: 0; color: var(--muted); font-size: 13px; }
.reminder-list { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.reminder-list li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.reminder-meta { color: var(--muted); }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; background: #eef2f7; color: var(--muted); }
.tag-warn { background: #fef3c7; color: #92400e; }
.tag-danger { background: #fee4e2; color: #b42318; }
.cell-note { margin-left: 6px; color: #92400e; font-size: 12px; }
.cell-missing { color: var(--muted); }
.cell-warn { color: #92400e; }
.cell-danger { color: #b42318; font-weight: 600; }
.row-abnormal { background: #fff7f6; }
.ok-text { color: #067647; }
</style>
