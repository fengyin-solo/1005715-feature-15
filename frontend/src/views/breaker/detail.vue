<template>
  <section class="page" data-module="breaker-detail">
    <header class="page-head">
      <div>
        <h2>断路器详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/breaker">← 返回断路器列表</RouterLink>
        </p>
      </div>
      <div v-if="breaker" class="page-actions">
        <button class="btn primary" type="button" @click="dialogBreaker = breaker">完成保养</button>
        <button class="btn" type="button" @click="runInspection">提出检修</button>
        <button class="btn ghost" type="button" @click="runRegister">登记运行</button>
      </div>
    </header>

    <div v-if="loadFailed" class="empty-state error-state detail-error">
      <p>断路器详情读取失败：{{ errorMessage }}</p>
      <button class="btn" type="button" @click="reload">重试</button>
    </div>

    <template v-else-if="breaker">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">
            {{ breaker.status }}
            <span v-if="isAbnormal" class="tag danger">异常</span>
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">上次保养日（保养记录口径）</span>
          <strong class="stat-value">{{ lastMaintenanceDate || '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">操作次数</span>
          <strong class="stat-value">
            {{ breaker['操作次数'] === '' || breaker['操作次数'] === undefined ? '—' : breaker['操作次数'] }}
            <span v-if="countExceeded" class="tag danger">超上限 {{ MAX_OPERATION_COUNT }}</span>
          </strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>
              <span v-if="field === '上次保养日'">{{ lastMaintenanceDate || '—' }}</span>
              <template v-else>
                <span>{{ breaker[field] === '' || breaker[field] === undefined ? '—' : breaker[field] }}</span>
                <span v-if="missingFields.includes(field) && fieldMissing(breaker, field)" class="missing-inline">
                  缺{{ field }}
                </span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <section class="panel">
        <h3 class="panel-title">保养记录（{{ records.length }}）</h3>
        <table v-if="records.length" class="data-table">
          <thead>
            <tr>
              <th>保养日期</th>
              <th>操作次数</th>
              <th>储能时间</th>
              <th>保养周期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in records" :key="record.id">
              <td>{{ record.保养日期 }}</td>
              <td>{{ record.操作次数 }}</td>
              <td>{{ record.储能时间 || '—' }}</td>
              <td>{{ record.保养周期 || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="panel-empty">还没有保养记录，台账行上的上次保养日仅作初始口径。</p>
      </section>

      <footer class="page-foot">
        <span v-if="notice" :class="notice.ok ? 'success-text' : 'error-text'">{{ notice.text }}</span>
      </footer>
    </template>

    <div v-else class="empty-state detail-error">
      <p>没有找到这台断路器。</p>
      <RouterLink class="btn" to="/breaker">返回列表</RouterLink>
    </div>

    <MaintenanceDialog :breaker="dialogBreaker" @cancel="dialogBreaker = null" @done="onMaintDone" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { moduleMeta } from '@/api/local-service'
import {
  fieldMissing,
  getBreaker,
  listBreakerMaintenance,
  MAX_OPERATION_COUNT,
  operationCountExceeded,
  registerRunning,
  requestInspection,
  resolveLastMaintenanceDate,
} from '@/api/breaker-service'
import type { EntryRow } from '@/data/types'
import type { MaintenanceRecord } from '@/data/types'
import MaintenanceDialog from './MaintenanceDialog.vue'

const route = useRoute()
const meta = moduleMeta('breaker')
const fields = meta.fields
const missingFields = ['操作次数', '储能时间']

const breaker = ref<EntryRow | null>(null)
const records = ref<MaintenanceRecord[]>([])
const errorMessage = ref('')
const loadFailed = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)
const dialogBreaker = ref<EntryRow | null>(null)

const lastMaintenanceDate = computed(() => (breaker.value ? resolveLastMaintenanceDate(breaker.value) : ''))
const countExceeded = computed(() => (breaker.value ? operationCountExceeded(breaker.value) : false))
const isAbnormal = computed(
  () => (breaker.value ? Boolean(breaker.value.abnormal) || operationCountExceeded(breaker.value) : false),
)

function onMaintDone(message: string) {
  const ok = !message.includes('未保存')
  if (ok) {
    dialogBreaker.value = null
  }
  notice.value = { ok, text: message }
  reload()
}

function runInspection() {
  if (!breaker.value) {
    return
  }
  const result = requestInspection(Number(breaker.value.id))
  notice.value = { ok: result.ok, text: result.message }
  reload()
}

function runRegister() {
  if (!breaker.value) {
    return
  }
  const result = registerRunning(Number(breaker.value.id))
  notice.value = { ok: result.ok, text: result.message }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const id = Number(route.params.id)
    const current = getBreaker(id)
    breaker.value = current
    records.value = current ? listBreakerMaintenance(id) : []
    loadFailed.value = false
  } catch (error) {
    breaker.value = null
    loadFailed.value = true
    errorMessage.value = error instanceof Error ? error.message : '断路器详情读取失败'
  }
}

onMounted(reload)
</script>
