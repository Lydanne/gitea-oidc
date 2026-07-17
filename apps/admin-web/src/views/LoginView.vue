<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { isAdminPath, toAdminPath } from "../runtimeConfig";

const route = useRoute();

/** 登录后返回路径。 */
const returnTo = computed(() => {
  const value = route.query.returnTo;
  return typeof value === "string" && isAdminPath(value) ? value : toAdminPath("/users");
});

/** 后端 OIDC 登录启动地址。 */
const loginStartUrl = computed(
  () => `${toAdminPath("/login/start")}?returnTo=${encodeURIComponent(returnTo.value)}`,
);
</script>

<template>
  <main class="login-page">
    <section class="login-panel" aria-labelledby="admin-login-title">
      <div class="login-brand">
        <span class="brand-mark">GO</span>
        <span>
          <strong>X OIDC</strong>
          <small>Admin Console</small>
        </span>
      </div>

      <div class="login-copy">
        <p class="eyebrow">后台管理</p>
        <h1 id="admin-login-title">登录管理台</h1>
        <p>使用本服务 OIDC 完成认证，只有配置的管理员组成员可以进入后台。</p>
      </div>

      <Button
        as="a"
        :href="loginStartUrl"
        icon="pi pi-lock"
        label="使用 OIDC 登录"
        class="login-action"
      />

      <p class="login-note">登录成功后将回到当前管理页面。</p>
    </section>
  </main>
</template>
