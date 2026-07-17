<script setup lang="ts">
import type { AdminUser } from "../types/admin";
import { formatDate, getUserStatusSeverity } from "../utils/format";
import { flattenUserGroupNames } from "../utils/userGroups";
import StatusTag from "./StatusTag.vue";

/** 用户详情属性。 */
defineProps<{
  user: AdminUser | null;
}>();
</script>

<template>
  <dl class="details">
    <dt>Sub</dt>
    <dd>{{ user?.sub }}</dd>
    <dt>用户名</dt>
    <dd>{{ user?.username || "-" }}</dd>
    <dt>显示名</dt>
    <dd>{{ user?.name || "-" }}</dd>
    <dt>邮箱</dt>
    <dd>{{ user?.email || "-" }}</dd>
    <dt>Provider</dt>
    <dd>{{ user?.authProvider || "-" }}</dd>
    <dt>外部 ID</dt>
    <dd>{{ user?.externalId || "-" }}</dd>
    <dt>组</dt>
    <dd>{{ flattenUserGroupNames(user?.groups).join(", ") || "-" }}</dd>
    <dt>角色</dt>
    <dd>{{ (user?.roles || []).join(", ") || "-" }}</dd>
    <dt>状态</dt>
    <dd>
      <StatusTag :value="user?.status || 'active'" :severity="getUserStatusSeverity(user?.status)" />
    </dd>
    <dt>最近登录</dt>
    <dd>{{ formatDate(user?.lastLoginAt) }}</dd>
    <dt>最近同步</dt>
    <dd>{{ formatDate(user?.lastSyncedAt) }}</dd>
  </dl>
</template>
