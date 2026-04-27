import { computed, createApp, onMounted, ref } from "/admin/assets/vue.esm-browser.prod.js";

const api = async (path, options = {}) => {
  const response = await fetch(`/admin/api${path}`, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (response.status === 401) {
    location.href = "/admin/login";
    return null;
  }

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

createApp({
  setup() {
    const loading = ref(true);
    const error = ref("");
    const view = ref("users");
    const me = ref(null);
    const users = ref([]);
    const providers = ref({ authProviders: [], apiProviders: [] });
    const tokens = ref([]);
    const keyword = ref("");

    const visibleUsers = computed(() => {
      const q = keyword.value.trim().toLowerCase();
      if (!q) return users.value;
      return users.value.filter((user) =>
        [user.username, user.name, user.email, user.authProvider, user.status]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q)),
      );
    });

    const loadAll = async () => {
      loading.value = true;
      error.value = "";
      try {
        me.value = await api("/me");
        users.value = (await api("/users")) ?? [];
        providers.value = (await api("/providers")) ?? providers.value;
        tokens.value = (await api("/tokens")) ?? [];
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        loading.value = false;
      }
    };

    const setStatus = async (user, status) => {
      await api(`/users/${encodeURIComponent(user.sub)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadAll();
    };

    const probeToken = async (token) => {
      await api("/tokens/probe", {
        method: "POST",
        body: JSON.stringify({
          provider: token.provider,
          ownerType: token.ownerType,
          ownerId: token.ownerId,
        }),
      });
      await loadAll();
    };

    onMounted(loadAll);

    return {
      error,
      keyword,
      loading,
      me,
      providers,
      probeToken,
      setStatus,
      tokens,
      view,
      visibleUsers,
    };
  },
  template: `
    <div v-if="loading" class="login">
      <div class="login-box">正在加载...</div>
    </div>

    <div v-else class="shell">
      <aside class="sidebar">
        <div class="brand">Gitea OIDC</div>
        <nav class="nav">
          <button :class="{ active: view === 'users' }" @click="view = 'users'">用户</button>
          <button :class="{ active: view === 'providers' }" @click="view = 'providers'">Provider</button>
          <button :class="{ active: view === 'tokens' }" @click="view = 'tokens'">Token</button>
        </nav>
      </aside>

      <main class="main">
        <div class="topbar">
          <h1>{{ view === 'users' ? '账号管理' : view === 'providers' ? 'Provider 状态' : 'Token 状态' }}</h1>
          <span class="muted">{{ me?.user?.name || me?.user?.username }}</span>
        </div>

        <div v-if="error" class="panel empty">{{ error }}</div>

        <section v-if="view === 'users'" class="panel">
          <div class="toolbar">
            <input v-model="keyword" placeholder="搜索用户名、邮箱、Provider 或状态" />
            <button class="button secondary" @click="loading = true; $nextTick(() => location.reload())">刷新</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>邮箱</th>
                  <th>Provider</th>
                  <th>组</th>
                  <th>状态</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in visibleUsers" :key="user.sub">
                  <td>
                    <strong>{{ user.name || user.username }}</strong>
                    <div class="muted">{{ user.username }}</div>
                  </td>
                  <td>{{ user.email }}</td>
                  <td>{{ user.authProvider }}</td>
                  <td>{{ (user.groups || []).join(', ') }}</td>
                  <td><span class="badge">{{ user.status || 'active' }}</span></td>
                  <td>{{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '-' }}</td>
                  <td>
                    <button v-if="(user.status || 'active') === 'active'" class="button danger" @click="setStatus(user, 'disabled')">禁用</button>
                    <button v-else class="button" @click="setStatus(user, 'active')">启用</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="view === 'providers'" class="panel">
          <div class="table-wrap">
            <table>
              <thead><tr><th>名称</th><th>显示名</th><th>状态</th><th>能力</th></tr></thead>
              <tbody>
                <tr v-for="provider in providers.authProviders" :key="provider.name">
                  <td>{{ provider.name }}</td>
                  <td>{{ provider.displayName }}</td>
                  <td><span class="badge">{{ provider.status?.healthy === false ? '异常' : '可用' }}</span></td>
                  <td>{{ (provider.features || []).join(', ') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="view === 'tokens'" class="panel">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Provider</th><th>主体</th><th>状态</th><th>过期时间</th><th>最近错误</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="token in tokens" :key="token.id">
                  <td>{{ token.provider }}</td>
                  <td>{{ token.ownerType }} / {{ token.ownerId }}</td>
                  <td><span class="badge">{{ token.status }}</span></td>
                  <td>{{ token.expiresAt ? new Date(token.expiresAt).toLocaleString() : '-' }}</td>
                  <td>{{ token.lastError || '-' }}</td>
                  <td><button class="button secondary" @click="probeToken(token)">探活</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  `,
}).mount("#app");
