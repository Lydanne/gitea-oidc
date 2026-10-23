<script setup lang="ts">
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import { computed } from "vue";
import StatusTag from "../components/StatusTag.vue";
import { useAdminDashboardContext } from "../composables/adminDashboardContext";
import type { TagSeverity } from "../types/admin";
import { getProviderSeverity } from "../utils/format";

/** Provider 表格行。 */
interface ProviderRow {
  key: string;
  name: string;
  type: string;
  displayName: string;
  status: string;
  severity: TagSeverity;
  detail: string;
}

const { providers } = useAdminDashboardContext();

/** 统一认证 Provider 与 Provider API 展示模型。 */
const providerRows = computed<ProviderRow[]>(() => [
  ...providers.value.authProviders.map((provider) => ({
    key: `auth:${provider.name}`,
    name: provider.name,
    type: "认证",
    displayName: provider.displayName || provider.name,
    status: provider.status?.healthy === false ? "异常" : "可用",
    severity: getProviderSeverity(provider),
    detail: (provider.features || []).join(", ") || provider.status?.message || "-",
  })),
  ...providers.value.apiProviders.map((provider) => ({
    key: `api:${provider.provider}`,
    name: provider.provider,
    type: "API",
    displayName: "Provider API",
    status: "已注册",
    severity: "info" as TagSeverity,
    detail: provider.baseUrl || "-",
  })),
]);
</script>

<template>
  <section class="content-panel">
    <DataTable
      :value="providerRows"
      data-key="key"
      striped-rows
      scrollable
      table-style="min-width: 54rem"
    >
      <Column field="name" header="名称" sortable style="min-width: 12rem" />
      <Column field="type" header="类型" sortable style="min-width: 8rem" />
      <Column field="displayName" header="显示名" style="min-width: 12rem" />
      <Column header="状态" style="min-width: 8rem">
        <template #body="{ data }">
          <StatusTag :value="data.status" :severity="data.severity" />
        </template>
      </Column>
      <Column field="detail" header="能力 / Base URL" style="min-width: 20rem" />
      <template #empty>
        <div class="empty-state">暂无 Provider</div>
      </template>
    </DataTable>
  </section>
</template>
