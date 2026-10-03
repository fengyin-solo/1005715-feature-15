<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备巡视清单</button>
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

    <section class="review-panel">
      <h3 class="review-title">待复查清单（断路器侧结论为需检修，共 {{ reviewRows.length }} 台）</h3>
      <p v-if="reviewLoadFailed" class="review-empty error-text">
        待复查清单读取失败：{{ reviewError || '数据暂不可用' }}
        <button class="btn" type="button" @click="loadReview">重试</button>
      </p>
      <p v-else-if="!reviewRows.length" class="review-empty">当前没有需检修的断路器，巡视侧暂无待复查项。</p>
      <table v-else class="data-table">
        <thead>
          <tr><th>设备编号</th><th>所属间隔</th><th>上次保养日</th><th>断路器结论</th><th>处理</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="String(row.id)">
            <td>{{ row['设备编号'] }}</td>
            <td>{{ row['所属间隔'] }}</td>
            <td>{{ lastMaintenanceDate(row) || '未保养' }}</td>
            <td><span class="tag tag-warn">需检修</span></td>
            <td class="row-actions">
              <RouterLink class="link" :to="`/breaker/${row.id}`">查看设备</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
            <p class="error-text">设备巡视列表读取失败：{{ errorMessage || '数据暂不可用' }}</p>
            <button class="btn" type="button" @click="reload">重试</button>
          </td>
        </tr>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设备巡视数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备巡视记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
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
import { lastMaintenanceDate, reviewPendingBreakers } from '@/data/breaker'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ['巡视编号', '巡视变电站', '巡视路线', '巡视人', '巡视日期', '发现缺陷数', '处理情况', '巡视状态']
const actions = ['提交巡视', '确认完成', '上报问题']
const statuses = ['待巡视', '巡视中', '已完成', '已上报']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const loadFailed = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const reviewRows = ref<EntryRow[]>([])
const reviewLoadFailed = ref(false)
const reviewError = ref('')

const stats = computed(() => [
  { label: '待巡视站点', value: rows.value.filter((row) => String(row.status) === '待巡视').length },
  { label: '已完成巡视', value: rows.value.filter((row) => String(row.status) === '已完成').length },
  { label: '待复查设备', value: reviewRows.value.length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function loadReview() {
  reviewLoadFailed.value = false
  reviewError.value = ''
  try {
    reviewRows.value = reviewPendingBreakers()
  } catch (error) {
    reviewRows.value = []
    reviewLoadFailed.value = true
    reviewError.value = error instanceof Error ? error.message : '待复查清单读取失败'
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
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
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
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
  loadReview()
}

onMounted(reload)
</script>

<style scoped>
.review-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid #b54708;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.review-title { margin: 0 0 8px; font-size: 14px; }
.review-empty { margin: 0; color: var(--muted); font-size: 13px; }
.review-empty .btn { margin-left: 8px; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.tag-warn { background: #fef3c7; color: #92400e; }
</style>
