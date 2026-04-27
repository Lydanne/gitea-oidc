<script setup lang="ts">
import ConfirmDialog from "primevue/confirmdialog";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import Toast from "primevue/toast";
import { computed, onMounted } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppShell from "./components/AppShell.vue";
import DashboardStats from "./components/DashboardStats.vue";
import { provideAdminDashboard } from "./composables/adminDashboardContext";
import { useAdminDashboard } from "./composables/useAdminDashboard";
import { getUserDisplayName } from "./utils/format";

const route = useRoute();
const dashboard = useAdminDashboard();
provideAdminDashboard(dashboard);

const { loading, refreshing, error, me, users, providers, tokens, loadAll, setError } = dashboard;

/** 当前路由标题。 */
const currentTitle = computed(() => String(route.meta.title ?? "账号管理"));

/** 当前路由说明。 */
const currentDescription = computed(() => String(route.meta.description ?? "管理后台"));

/** 当前会话展示名。 */
const meName = computed(() => getUserDisplayName(me.value?.user));

/** 静默刷新后台数据。 */
const refresh = async () => {
  try {
    await loadAll({ silent: true });
  } catch {
    // 错误消息已由 composable 写入全局状态。
  }
};

onMounted(() => {
  loadAll().catch(() => undefined);
});
</script>

<template>
  <Toast position="top-right" />
  <ConfirmDialog />

  <div v-if="loading" class="loading-screen">
    <ProgressSpinner aria-label="正在加载" />
    <span>正在加载管理台</span>
  </div>

  <AppShell
    v-else
    :title="currentTitle"
    :description="currentDescription"
    :me-name="meName"
    :refreshing="refreshing"
    @refresh="refresh"
  >
    <Message v-if="error" severity="error" class="admin-message" :closable="false">
      {{ error }}
    </Message>

    <DashboardStats :users="users" :providers="providers" :tokens="tokens" />

    <RouterView @error="setError" />
  </AppShell>
</template>

