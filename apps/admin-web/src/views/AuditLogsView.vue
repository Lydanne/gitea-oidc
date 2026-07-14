<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable, { type DataTablePageEvent } from "primevue/datatable";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Toolbar from "primevue/toolbar";
import { useToast } from "primevue/usetoast";
import { computed, onMounted, ref, watch } from "vue";
import { fetchAuditLogs } from "../api/adminApi";
import StatusTag from "../components/StatusTag.vue";
import { useAdminDashboardContext } from "../composables/adminDashboardContext";
import type { AuditEventType, AuditLogFilters, AuditLogRecord, AuditOutcome } from "../types/admin";
import { formatDate, getUserDisplayName } from "../utils/format";

const toast = useToast();
const { users, refreshing, setError } = useAdminDashboardContext();
const logs = ref<AuditLogRecord[]>([]);
const total = ref(0);
const loading = ref(false);
const first = ref(0);
const rows = ref(20);
const userId = ref("");
const eventType = ref<AuditEventType | null>(null);
const outcome = ref<AuditOutcome | null>(null);
const from = ref("");
const to = ref("");

const eventOptions: Array<{ label: string; value: AuditEventType }> = [
  { label: "用户登录", value: "user.login" },
  { label: "用户退出", value: "user.logout" },
  { label: "管理台登录", value: "admin.login" },
  { label: "管理台退出", value: "admin.logout" },
  { label: "创建用户", value: "user.created" },
  { label: "更新用户", value: "user.updated" },
  { label: "删除用户", value: "user.deleted" },
];

const outcomeOptions: Array<{ label: string; value: AuditOutcome }> = [
  { label: "成功", value: "success" },
  { label: "失败", value: "failure" },
];

const userOptions = computed(() =>
  users.value.map((user) => ({
    label: `${getUserDisplayName(user)} (${user.sub})`,
    value: user.sub,
  })),
);

const userNames = computed(
  () => new Map(users.value.map((user) => [user.sub, getUserDisplayName(user)])),
);

const eventLabels = new Map(eventOptions.map((option) => [option.value, option.label]));

const buildFilters = (): AuditLogFilters => ({
  ...(userId.value.trim() ? { userId: userId.value.trim() } : {}),
  ...(eventType.value ? { eventType: eventType.value } : {}),
  ...(outcome.value ? { outcome: outcome.value } : {}),
  ...(from.value ? { from: new Date(from.value).toISOString() } : {}),
  ...(to.value ? { to: new Date(to.value).toISOString() } : {}),
  offset: first.value,
  limit: rows.value,
});

const loadLogs = async () => {
  loading.value = true;
  try {
    const page = await fetchAuditLogs(buildFilters());
    logs.value = page?.items ?? [];
    total.value = page?.total ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setError(message);
    toast.add({ severity: "error", summary: "审计日志加载失败", detail: message, life: 3600 });
  } finally {
    loading.value = false;
  }
};

const applyFilters = async () => {
  first.value = 0;
  await loadLogs();
};

const resetFilters = async () => {
  userId.value = "";
  eventType.value = null;
  outcome.value = null;
  from.value = "";
  to.value = "";
  await applyFilters();
};

const changePage = async (event: DataTablePageEvent) => {
  first.value = event.first;
  rows.value = event.rows;
  await loadLogs();
};

const displayUser = (log: AuditLogRecord) =>
  log.username || (log.userId ? userNames.value.get(log.userId) : undefined) || log.userId || "-";

const displayActor = (log: AuditLogRecord) =>
  (log.actorUserId ? userNames.value.get(log.actorUserId) : undefined) || log.actorUserId || "-";

onMounted(loadLogs);

let refreshRequested = false;
watch(refreshing, (value) => {
  if (value) {
    refreshRequested = true;
  } else if (refreshRequested) {
    refreshRequested = false;
    void loadLogs();
  }
});
</script>

<template>
  <section class="content-panel">
    <Toolbar class="admin-toolbar audit-toolbar">
      <template #start>
        <InputText
          v-model="userId"
          list="audit-user-options"
          placeholder="用户 ID（支持历史用户）"
          aria-label="用户 ID"
          class="audit-filter"
        />
        <datalist id="audit-user-options">
          <option v-for="user in userOptions" :key="user.value" :value="user.value">
            {{ user.label }}
          </option>
        </datalist>
        <Select
          v-model="eventType"
          :options="eventOptions"
          option-label="label"
          option-value="value"
          placeholder="全部事件"
          show-clear
          class="audit-filter"
        />
        <Select
          v-model="outcome"
          :options="outcomeOptions"
          option-label="label"
          option-value="value"
          placeholder="全部结果"
          show-clear
          class="audit-filter"
        />
        <InputText v-model="from" type="datetime-local" aria-label="开始时间" />
        <InputText v-model="to" type="datetime-local" aria-label="结束时间" />
      </template>
      <template #end>
        <Button label="重置" severity="secondary" outlined @click="resetFilters" />
        <Button icon="pi pi-search" label="查询" :loading="loading" @click="applyFilters" />
      </template>
    </Toolbar>

    <DataTable
      :value="logs"
      data-key="id"
      lazy
      paginator
      :first="first"
      :rows="rows"
      :total-records="total"
      :rows-per-page-options="[20, 50, 100]"
      :loading="loading"
      striped-rows
      scrollable
      table-style="min-width: 82rem"
      @page="changePage"
    >
      <Column header="时间" style="min-width: 12rem">
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column header="事件" style="min-width: 9rem">
        <template #body="{ data }">{{ eventLabels.get(data.eventType) || data.eventType }}</template>
      </Column>
      <Column header="结果" style="min-width: 7rem">
        <template #body="{ data }">
          <StatusTag
            :value="data.outcome === 'success' ? '成功' : '失败'"
            :severity="data.outcome === 'success' ? 'success' : 'danger'"
          />
        </template>
      </Column>
      <Column header="用户" style="min-width: 14rem">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ displayUser(data) }}</strong>
            <small>{{ data.userId || "-" }}</small>
          </div>
        </template>
      </Column>
      <Column header="操作人" style="min-width: 12rem">
        <template #body="{ data }">{{ displayActor(data) }}</template>
      </Column>
      <Column header="来源 / 客户端" style="min-width: 12rem">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.provider || data.source }}</strong>
            <small>{{ data.clientId || "-" }}</small>
          </div>
        </template>
      </Column>
      <Column header="变更/原因" style="min-width: 18rem">
        <template #body="{ data }">
          {{ data.changedFields?.join(", ") || data.reason || "-" }}
          <small v-if="data.statusFrom || data.statusTo" class="audit-status-change">
            {{ data.statusFrom || "-" }} → {{ data.statusTo || "-" }}
          </small>
        </template>
      </Column>
      <Column field="ipAddress" header="IP" style="min-width: 10rem">
        <template #body="{ data }">{{ data.ipAddress || "-" }}</template>
      </Column>
      <Column field="userAgent" header="User-Agent" style="min-width: 18rem">
        <template #body="{ data }">{{ data.userAgent || "-" }}</template>
      </Column>
      <template #empty>
        <div class="empty-state">暂无匹配的审计日志</div>
      </template>
    </DataTable>
  </section>
</template>
