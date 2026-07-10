<script setup lang="ts">
import { computed } from "vue";
import type { AdminUser, ProviderState, ProviderToken } from "../types/admin";

/** 指标条属性。 */
const props = defineProps<{
  users: AdminUser[];
  providers: ProviderState;
  tokens: ProviderToken[];
}>();

/** 管理台顶部统计指标。 */
const stats = computed(() => {
  const inactiveUsers = props.users.filter((user) => (user.status ?? "active") !== "active").length;
  const providerCount = props.providers.authProviders.length + props.providers.apiProviders.length;
  const unhealthyProviders = props.providers.authProviders.filter(
    (provider) => provider.status?.healthy === false,
  ).length;
  const tokenIssues = props.tokens.filter(
    (token) => !["active", "healthy"].includes(token.status),
  ).length;

  return [
    { label: "用户总数", value: props.users.length, detail: `${inactiveUsers} 个非活跃账号` },
    {
      label: "Provider",
      value: providerCount,
      detail: unhealthyProviders > 0 ? `${unhealthyProviders} 个异常` : "全部可用",
    },
    { label: "Token", value: props.tokens.length, detail: `${tokenIssues} 个需要关注` },
  ];
});
</script>

<template>
  <section class="stats-grid" aria-label="管理台指标">
    <article v-for="item in stats" :key="item.label" class="stat-panel">
      <span>{{ item.label }}</span>
      <strong>{{ item.value }}</strong>
      <small>{{ item.detail }}</small>
    </article>
  </section>
</template>

