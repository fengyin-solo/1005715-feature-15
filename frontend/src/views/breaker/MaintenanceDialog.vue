<template>
  <div v-if="breaker" class="modal-mask" @click.self="emit('cancel')">
    <div class="modal-card" role="dialog" aria-modal="true" :aria-label="`${String(breaker['设备编号'])} 保养登记`">
      <header class="modal-head">
        <strong>保养登记 · {{ String(breaker['设备编号']) }}</strong>
        <button class="link" type="button" @click="emit('cancel')">关闭</button>
      </header>
      <p class="modal-hint">{{ String(breaker['所属间隔'] ?? '') }} · 保养周期口径：{{ cycleText }}</p>
      <form class="modal-form" @submit.prevent="submit">
        <label class="modal-field">
          <span>保养日期<em>*</em></span>
          <input v-model="form.date" type="date" required />
        </label>
        <label class="modal-field">
          <span>操作次数<em>*</em></span>
          <input
            v-model="form.countText"
            type="number"
            min="0"
            step="1"
            required
            :placeholder="`不超过 ${MAX_OPERATION_COUNT} 次`"
          />
        </label>
        <label class="modal-field">
          <span>储能时间</span>
          <input v-model="form.chargeTime" type="date" />
        </label>
        <label class="modal-field">
          <span>保养周期</span>
          <input v-model="form.cycle" type="text" placeholder="如 6月 / 1年，缺周期时在这里补登" />
        </label>
        <p v-if="errorText" class="error-text modal-error">{{ errorText }}</p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="emit('cancel')">取消</button>
          <button class="btn primary" type="submit">提交保养</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  MAX_OPERATION_COUNT,
  parseCycleMonths,
  submitMaintenance,
  todayISO,
} from '@/api/breaker-service'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ breaker: EntryRow | null }>()
const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'done', message: string): void
}>()

const form = reactive({
  date: todayISO(),
  countText: '',
  chargeTime: '',
  cycle: '',
})

const errorText = ref('')

const cycleText = computed(() => {
  if (!props.breaker) {
    return ''
  }
  const months = parseCycleMonths(props.breaker['保养周期'])
  return months === null ? '未登记，建议本次一并补登' : `${months} 个月`
})

watch(
  () => props.breaker,
  (breaker) => {
    errorText.value = ''
    if (!breaker) {
      return
    }
    form.date = todayISO()
    form.countText =
      breaker['操作次数'] === '' || breaker['操作次数'] === undefined ? '' : String(breaker['操作次数'])
    form.chargeTime = String(breaker['储能时间'] ?? '')
    form.cycle = String(breaker['保养周期'] ?? '')
  },
  { immediate: true },
)

function submit() {
  if (!props.breaker) {
    return
  }
  const count = Number(form.countText)
  if (form.countText.trim() === '' || !Number.isInteger(count) || count < 0) {
    errorText.value = '操作次数需为不小于 0 的整数'
    return
  }
  const result = submitMaintenance({
    breakerId: Number(props.breaker.id),
    保养日期: form.date,
    操作次数: count,
    储能时间: form.chargeTime,
    保养周期: form.cycle,
  })
  if (!result.ok) {
    errorText.value = result.message
    return
  }
  emit('done', result.message)
}
</script>
