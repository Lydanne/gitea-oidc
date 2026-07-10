<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";
import { RouterLink } from "vue-router";

/** 主框架属性。 */
const props = defineProps<{
  title: string;
  description: string;
  meName: string;
  refreshing: boolean;
  applicationsEnabled: boolean;
}>();

/** 主框架事件。 */
defineEmits<{
  refresh: [];
}>();

/** 侧边导航项。 */
const navItems = computed(() => [
  { label: "账号", to: "/users", icon: "pi pi-users" },
  ...(props.applicationsEnabled ? [{ label: "应用", to: "/applications", icon: "pi pi-box" }] : []),
  { label: "Provider", to: "/providers", icon: "pi pi-sitemap" },
  { label: "Token", to: "/tokens", icon: "pi pi-key" },
]);
</script>

<template>
  <div class="admin-shell">
    <aside class="sidebar" aria-label="管理台导航">
      <div class="brand">
        <span class="brand-mark">GO</span>
        <span>
          <strong>Gitea OIDC</strong>
          <small>Admin Console</small>
        </span>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          active-class="active"
        >
          <i :class="item.icon" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">后台管理</p>
          <h1>{{ title }}</h1>
          <p class="page-description">{{ description }}</p>
        </div>

        <div class="topbar-actions">
          <span class="session-user">{{ meName }}</span>
          <Button
            icon="pi pi-refresh"
            label="刷新"
            severity="secondary"
            outlined
            size="small"
            :loading="refreshing"
            @click="$emit('refresh')"
          />
        </div>
      </header>

      <slot />
    </main>
  </div>
</template>
