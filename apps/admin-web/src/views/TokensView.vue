<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import { useToast } from "primevue/usetoast";
import { computed, ref } from "vue";
import StatusTag from "../components/StatusTag.vue";
import { useAdminDashboardContext } from "../composables/adminDashboardContext";
import type { ProviderToken } from "../types/admin";
import { formatDate, getTokenSeverity } from "../utils/format";

const toast = useToast();
const { tokens, probeToken, setError } = useAdminDashboardContext();
const probingKey = ref("");

/** 获取 token 在表格中的稳定 key。 */
const getTokenKey = (token: ProviderToken) =>
  token.id ?? `${token.provider}:${token.ownerType}:${token.ownerId}`;

/** 带稳定行 key 的 token 列表。 */
const tokenRows = computed(() =>
  tokens.value.map((token) => ({
    ...token,
    rowKey: getTokenKey(token),
  })),
);

/** 统一处理 token 操作异常。 */
const handleError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  setError(message);
  toast.add({ severity: "error", summary: "探活失败", detail: message, life: 3600 });
};

/** 手动探活 token。 */
const probe = async (token: ProviderToken) => {
  probingKey.value = getTokenKey(token);
  try {
    await probeToken(token);
    toast.add({ severity: "success", summary: "探活完成", life: 2200 });
  } catch (err) {
    handleError(err);
  } finally {
    probingKey.value = "";
  }
};
</script>

<template>
  <section class="content-panel">
    <DataTable
      :value="tokenRows"
      data-key="rowKey"
      paginator
      :rows="10"
      :rows-per-page-options="[10, 20, 50]"
      striped-rows
      scrollable
      table-style="min-width: 62rem"
    >
      <Column field="provider" header="Provider" sortable style="min-width: 10rem" />
      <Column header="主体" style="min-width: 18rem">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.ownerType }}</strong>
            <small>{{ data.ownerId }}</small>
          </div>
        </template>
      </Column>
      <Column header="状态" sortable sort-field="status" style="min-width: 9rem">
        <template #body="{ data }">
          <StatusTag :value="data.status" :severity="getTokenSeverity(data)" />
        </template>
      </Column>
      <Column header="过期时间" sortable sort-field="expiresAt" style="min-width: 14rem">
        <template #body="{ data }">{{ formatDate(data.expiresAt) }}</template>
      </Column>
      <Column field="lastError" header="最近错误" style="min-width: 18rem">
        <template #body="{ data }">{{ data.lastError || "-" }}</template>
      </Column>
      <Column header="操作" style="min-width: 8rem">
        <template #body="{ data }">
          <Button
            icon="pi pi-heart"
            label="探活"
            size="small"
            severity="secondary"
            outlined
            :loading="probingKey === getTokenKey(data)"
            @click="probe(data)"
          />
        </template>
      </Column>
      <template #empty>
        <div class="empty-state">暂无 Provider token</div>
      </template>
    </DataTable>
  </section>
</template>
