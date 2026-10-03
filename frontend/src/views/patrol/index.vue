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

    <!-- 待复查清单：断路器那边得出「需检修」结论后同步到这里，按设备去重。 -->
    <section class="panel">
      <h3 class="panel-title">待复查清单（来自断路器检修结论，{{ rechecks.length }}）</h3>
      <table v-if="rechecks.length" class="data-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>所属间隔</th>
            <th>结论</th>
            <th>提出时间</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rechecks" :key="item.breakerId">
            <td>
              <RouterLink class="link" :to="`/breaker/${item.breakerId}`">{{ item.设备编号 }}</RouterLink>
            </td>
            <td>{{ item.所属间隔 }}</td>
            <td><span class="tag danger">{{ item.结论 }}</span></td>
            <td>{{ item.提出时间 }}</td>
            <td>{{ item.来源 }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="panel-empty">暂无待复查设备；断路器被提出检修后会自动进入本清单，保养完成后自动撤出。</p>
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
          <td :colspan="columns.length + 2" class="empty-state error-state">
            <p>设备巡视列表读取失败：{{ errorMessage }}</p>
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
import { listPendingRechecks } from '@/api/breaker-service'
import type { RecheckItem } from '@/data/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视编号", "巡视变电站", "巡视路线", "巡视人", "巡视日期", "发现缺陷数", "处理情况", "巡视状态"]
const actions = ["提交巡视", "确认完成", "上报问题"]
const statuses = ["待巡视", "巡视中", "已完成", "已上报"]
const stats = [{"label": "待巡视站点", "value": 0}, {"label": "已完成巡视", "value": 0}, {"label": "本月发现问题数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const loadFailed = ref(false)
const rechecks = ref<RecheckItem[]>([])
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadFailed.value = false
    rechecks.value = listPendingRechecks()
  } catch (error) {
    rows.value = []
    total.value = 0
    loadFailed.value = true
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
}

onMounted(reload)
</script>
