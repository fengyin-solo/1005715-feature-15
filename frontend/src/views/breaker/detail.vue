<template>
  <section class="page" data-module="breaker-detail">
    <header class="page-head">
      <div>
        <h2>断路器详情</h2>
        <p class="page-desc">上次保养日与断路器列表沿用同一保养口径：优先取最近一次保养记录，其次取台账登记值。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/breaker">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="loadFailed" class="detail-error">
      <p class="error-text">断路器详情读取失败：{{ errorMessage || '数据暂不可用' }}</p>
      <button class="btn" type="button" @click="load">重试</button>
    </div>
    <div v-else-if="!row" class="detail-error">
      <p class="empty-state">没有找到该断路器，可能已被删除或编号有误。</p>
      <RouterLink class="btn" to="/breaker">返回列表</RouterLink>
    </div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">上次保养日（与列表一致）</span>
          <strong class="stat-value">{{ lastDate || '未保养' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">操作次数</span>
          <strong class="stat-value" :class="{ 'cell-danger': isOverLimit(row) }">
            {{ miss.operations ? '未登记操作次数' : row['操作次数'] }}
            <span v-if="isOverLimit(row)" class="tag tag-danger">超上限异常</span>
          </strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="column in columns" :key="column">
            <th>{{ column }}</th>
            <td :class="detailCellClass(column)">
              <template v-if="column === '操作次数'">{{ miss.operations ? '未登记操作次数' : row[column] }}</template>
              <template v-else-if="column === '储能时间'">{{ miss.chargeTime ? '未登记储能时间' : row[column] }}</template>
              <template v-else-if="column === '保养周期'">
                {{ row[column] || '—' }}
                <span v-if="miss.cycle" class="cell-note">缺周期</span>
              </template>
              <template v-else-if="column === '上次保养日'">
                {{ lastDate || '未保养' }}
                <span v-if="log" class="tag">以最近一次保养记录 {{ log.date }} 为准</span>
              </template>
              <template v-else>{{ row[column] || '—' }}</template>
            </td>
          </tr>
        </tbody>
      </table>

      <section class="reminder-panel">
        <h3 class="reminder-title">保养记录</h3>
        <p v-if="!log" class="reminder-empty">这台设备还没有提交过保养；保养提交后同一台设备只保留最近一条。</p>
        <table v-else class="data-table">
          <thead>
            <tr><th>保养日期</th><th>设备编号</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ log.date }}</td>
              <td>{{ log['设备编号'] }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="isDue(row)" class="due-note">
          按周期 {{ row['保养周期'] }} 计算已到期<span v-if="overdueDays(row) > 0">（超期 {{ overdueDays(row) }} 天）</span>，请尽快安排保养。
        </p>
        <p v-else-if="miss.cycle" class="due-note due-warn">保养周期未登记，无法参与到期提醒，请先补登周期。</p>
      </section>

      <div class="row-actions detail-actions">
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          :class="{ primary: action === '完成保养' }"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <p v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  isMaintenanceDue,
  isOverOperationLimit,
  lastMaintenanceDate,
  maintenanceLogOf,
  missingFields,
  overdueDays as calcOverdueDays,
} from '@/data/breaker'
import type { BreakerMaintenanceLog } from '@/data/breaker'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const meta = moduleMeta('breaker')
const columns = ['设备编号', '所属间隔', '断路器型号', '操作次数', '储能时间', '保养周期', '上次保养日', '设备状态']
const actions = ['登记运行', '完成保养', '提出检修']

const row = ref<EntryRow | null>(null)
const log = ref<BreakerMaintenanceLog | null>(null)
const errorMessage = ref('')
const loadFailed = ref(false)
const actionMessage = ref('')
const actionOk = ref(false)

const deviceId = computed(() => Number(route.params.id))
const lastDate = computed(() => (row.value ? lastMaintenanceDate(row.value) : ''))
const miss = computed(() => (row.value ? missingFields(row.value) : { cycle: false, chargeTime: false, operations: false }))

function isOverLimit(target: EntryRow): boolean {
  return isOverOperationLimit(target)
}

function isDue(target: EntryRow): boolean {
  return isMaintenanceDue(target)
}

function overdueDays(target: EntryRow): number {
  return calcOverdueDays(target)
}

function detailCellClass(column: string): Record<string, boolean> {
  return {
    'cell-missing':
      (column === '操作次数' && miss.value.operations) ||
      (column === '储能时间' && miss.value.chargeTime) ||
      (column === '上次保养日' && !lastDate.value),
    'cell-danger': Boolean(row.value && column === '操作次数' && isOverLimit(row.value)),
    'cell-warn': column === '保养周期' && miss.value.cycle,
  }
}

function runAction(action: string) {
  if (!row.value) {
    return
  }
  actionMessage.value = ''
  const result = applyAction(meta.key, Number(row.value.id), action)
  actionOk.value = result.ok
  actionMessage.value = result.message
  load()
}

function load() {
  errorMessage.value = ''
  loadFailed.value = false
  try {
    const target = listRows(meta.key).find((item) => Number(item.id) === deviceId.value) ?? null
    row.value = target
    log.value = target ? maintenanceLogOf(Number(target.id)) : null
  } catch (error) {
    loadFailed.value = true
    row.value = null
    errorMessage.value = error instanceof Error ? error.message : '断路器详情读取失败'
  }
}

onMounted(load)
</script>

<style scoped>
.detail-table th { width: 160px; background: #f8fafc; }
.reminder-panel { margin-top: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
.reminder-title { margin: 0 0 8px; font-size: 14px; }
.reminder-empty { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
.due-note { margin: 10px 0 0; color: #92400e; font-size: 13px; }
.due-warn { color: var(--muted); }
.detail-error { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-align: center; }
.detail-actions { margin-top: 14px; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; background: #eef2f7; color: var(--muted); margin-left: 6px; }
.tag-danger { background: #fee4e2; color: #b42318; }
.cell-note { margin-left: 6px; color: #92400e; font-size: 12px; }
.cell-missing { color: var(--muted); }
.cell-warn { color: #92400e; }
.cell-danger { color: #b42318; font-weight: 600; }
.ok-text { color: #067647; }
</style>
