<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "../components/ui/card";
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
  <main class="login-page shadcn-theme">
    <div class="login-shell">
      <div class="login-brand" aria-label="X OIDC">
        <span class="login-brand-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" focusable="false">
            <path d="m6 5 12 14M18 5 6 19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            <path d="M4 12h3m10 0h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </span>
        <strong>X OIDC</strong>
      </div>
      <Card class="login-panel" aria-labelledby="admin-login-title">
        <CardHeader class="login-copy">
          <p class="login-eyebrow">管理控制台</p>
          <h1 id="admin-login-title">登录管理台</h1>
          <CardDescription>欢迎回来，使用管理员账号继续。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button as="a" :href="loginStartUrl" size="lg" class="login-action">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" stroke-width="1.7" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            登录管理台
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </Button>
        </CardContent>
        <CardFooter class="login-note">仅限授权管理员访问</CardFooter>
      </Card>
      <p class="login-caption">统一身份认证 · X OIDC</p>
    </div>
  </main>
</template>
