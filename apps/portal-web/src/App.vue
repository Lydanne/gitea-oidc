<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { fetchPortalApplications, fetchPortalSession, logoutPortal } from "./api/portalApi";
import { portalRuntimeConfig, toPortalPath } from "./runtimeConfig";
import type { PortalApplication, PortalSession } from "./types/portal";
import { formatInitial, formatUserName, toSafeLaunchUrl } from "./utils/format";

const session = ref<PortalSession | null>(null);
const applications = ref<PortalApplication[]>([]);
const loading = ref(true);
const errorMessage = ref("");
const logoutError = ref("");
const loggingOut = ref(false);
const avatarFailed = ref(false);
const failedIcons = reactive(new Set<string>());
const signedOut =
  globalThis.location.pathname === `${portalRuntimeConfig.basePath}/signed-out` ||
  globalThis.location.pathname === `${portalRuntimeConfig.basePath}/signed-out/`;

const displayName = computed(() => (session.value ? formatUserName(session.value.user) : "用户"));
const userInitial = computed(() => formatInitial(displayName.value));
const userMeta = computed(() => session.value?.user.email ?? session.value?.user.username ?? "");
const reloginUrl = `${toPortalPath("/login/start")}?returnTo=${encodeURIComponent(portalRuntimeConfig.basePath)}`;
const liveStatus = computed(() => {
  if (loading.value) return "正在加载应用";
  if (errorMessage.value) return "应用加载失败";
  if (applications.value.length === 0) return "暂时没有可用应用";
  return `已加载 ${applications.value.length} 个应用`;
});

async function loadPortal(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";
  avatarFailed.value = false;
  failedIcons.clear();

  try {
    const [nextSession, nextApplications] = await Promise.all([
      fetchPortalSession(),
      fetchPortalApplications(),
    ]);
    if (!nextSession || !nextApplications) return;
    session.value = nextSession;
    applications.value = nextApplications;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "暂时无法加载应用，请稍后重试。";
  } finally {
    loading.value = false;
  }
}

async function handleLogout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  logoutError.value = "";
  try {
    await logoutPortal();
  } catch (error) {
    logoutError.value = error instanceof Error ? error.message : "退出失败，请稍后重试。";
    loggingOut.value = false;
  }
}

function markIconFailed(applicationId: string): void {
  failedIcons.add(applicationId);
}

function launchUrl(application: PortalApplication): string | null {
  return toSafeLaunchUrl(application.launchUrl, globalThis.location.origin);
}

onMounted(() => {
  if (!signedOut) void loadPortal();
});
</script>

<template>
  <div class="portal-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" :href="portalRuntimeConfig.basePath" aria-label="返回应用中心首页">
          <span class="brand-mark" aria-hidden="true">G</span>
          <span>应用中心</span>
        </a>

        <div v-if="session && !signedOut" class="account-actions">
          <a
            v-if="session.admin"
            class="secondary-button admin-link"
            :href="portalRuntimeConfig.adminBasePath"
          >
            管理后台
          </a>

          <div class="account-summary">
            <img
              v-if="session.user.picture && !avatarFailed"
              class="avatar"
              :src="session.user.picture"
              :alt="`${displayName}的头像`"
              referrerpolicy="no-referrer"
              @error="avatarFailed = true"
            >
            <span v-else class="avatar avatar-fallback" aria-hidden="true">{{ userInitial }}</span>
            <span class="account-copy">
              <strong>{{ displayName }}</strong>
              <span v-if="userMeta">{{ userMeta }}</span>
            </span>
          </div>

          <button
            class="text-button"
            type="button"
            :disabled="loggingOut"
            @click="handleLogout"
          >
            {{ loggingOut ? "正在退出…" : "退出" }}
          </button>
        </div>
      </div>
    </header>

    <main v-if="signedOut" id="main-content" class="main-content signed-out-content" tabindex="-1">
      <section class="state-panel signed-out-panel">
        <span class="state-icon success-icon" aria-hidden="true">✓</span>
        <p class="eyebrow">Signed out</p>
        <h1>已安全退出</h1>
        <p>你的本地会话已经结束。如需继续使用应用中心，请重新登录。</p>
        <a
          class="primary-button"
          :href="reloginUrl"
        >
          重新登录
        </a>
      </section>
    </main>

    <main v-else id="main-content" class="main-content" tabindex="-1">
      <p class="sr-only" role="status" aria-live="polite">{{ liveStatus }}</p>
      <section class="hero" aria-labelledby="portal-heading">
        <p class="eyebrow">Workspace</p>
        <h1 id="portal-heading">欢迎回来<span v-if="session">，{{ displayName }}</span></h1>
        <p>选择一个应用，继续你的工作。</p>
      </section>

      <p v-if="logoutError" class="inline-error" role="alert">{{ logoutError }}</p>

      <section v-if="loading" class="application-grid" aria-label="正在加载应用" aria-busy="true">
        <article v-for="index in 6" :key="index" class="application-card skeleton-card" aria-hidden="true">
          <span class="skeleton skeleton-icon"></span>
          <span class="skeleton skeleton-title"></span>
          <span class="skeleton skeleton-copy"></span>
        </article>
      </section>

      <section v-else-if="errorMessage" class="state-panel" role="alert">
        <span class="state-icon" aria-hidden="true">!</span>
        <h2>应用加载失败</h2>
        <p>{{ errorMessage }}</p>
        <button class="primary-button" type="button" @click="loadPortal">重新加载</button>
      </section>

      <section v-else-if="applications.length === 0" class="state-panel">
        <span class="state-icon empty-icon" aria-hidden="true">○</span>
        <h2>暂时没有可用应用</h2>
        <p>管理员发布应用后，它们会出现在这里。</p>
      </section>

      <section v-else class="application-grid" aria-label="可用应用">
        <template v-for="application in applications" :key="application.id">
          <a
            v-if="launchUrl(application)"
            class="application-card"
            :href="launchUrl(application) ?? undefined"
          >
            <span class="application-icon">
              <img
                v-if="application.iconUrl && !failedIcons.has(application.id)"
                :src="application.iconUrl"
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                @error="markIconFailed(application.id)"
              >
              <span v-else aria-hidden="true">{{ formatInitial(application.name) }}</span>
            </span>
            <span class="application-body">
              <strong>{{ application.name }}</strong>
              <span>{{ application.description || `打开 ${application.name}` }}</span>
            </span>
            <svg class="card-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <article v-else class="application-card application-card-disabled" aria-disabled="true">
            <span class="application-icon" aria-hidden="true">{{ formatInitial(application.name) }}</span>
            <span class="application-body">
              <strong>{{ application.name }}</strong>
              <span>应用入口暂不可用</span>
            </span>
          </article>
        </template>
      </section>
    </main>

    <footer class="footer">
      <span>Gitea OIDC</span>
      <span aria-hidden="true">·</span>
      <span>统一身份与应用入口</span>
    </footer>
  </div>
</template>
