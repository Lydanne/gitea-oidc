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

const blankUserForm = () => ({
  username: "",
  name: "",
  email: "",
  authProvider: "local",
  externalId: "",
  groups: "",
  roles: "",
  status: "active",
  picture: "",
  phone: "",
});

const listToText = (value) => (Array.isArray(value) ? value.join(", ") : "");
const textToList = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const userToForm = (user) => ({
  username: user.username ?? "",
  name: user.name ?? "",
  email: user.email ?? "",
  authProvider: user.authProvider ?? "local",
  externalId: user.externalId ?? user.username ?? "",
  groups: listToText(user.groups),
  roles: listToText(user.roles),
  status: user.status ?? "active",
  picture: user.picture ?? "",
  phone: user.phone ?? "",
});

const formToPayload = (form) => {
  const username = form.username.trim();
  const externalId = form.externalId.trim() || username;

  return {
    username,
    name: form.name.trim() || username,
    email: form.email.trim() || `${username}@local`,
    authProvider: form.authProvider.trim() || "local",
    externalId,
    groups: textToList(form.groups),
    roles: textToList(form.roles),
    status: form.status,
    ...(form.picture.trim() ? { picture: form.picture.trim() } : {}),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
  };
};

createApp({
  setup() {
    const loading = ref(true);
    const saving = ref(false);
    const error = ref("");
    const view = ref("users");
    const me = ref(null);
    const users = ref([]);
    const providers = ref({ authProviders: [], apiProviders: [] });
    const tokens = ref([]);
    const keyword = ref("");
    const dialogMode = ref("");
    const selectedUser = ref(null);
    const userForm = ref(blankUserForm());

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

    const openCreate = () => {
      selectedUser.value = null;
      userForm.value = blankUserForm();
      dialogMode.value = "create";
    };

    const openDetail = (user) => {
      selectedUser.value = user;
      userForm.value = userToForm(user);
      dialogMode.value = "detail";
    };

    const openEdit = (user) => {
      selectedUser.value = user;
      userForm.value = userToForm(user);
      dialogMode.value = "edit";
    };

    const closeDialog = () => {
      dialogMode.value = "";
      selectedUser.value = null;
      userForm.value = blankUserForm();
    };

    const saveUser = async () => {
      const payload = formToPayload(userForm.value);
      if (!payload.username) {
        error.value = "用户名不能为空";
        return;
      }

      saving.value = true;
      try {
        if (dialogMode.value === "edit" && selectedUser.value) {
          await api(`/users/${encodeURIComponent(selectedUser.value.sub)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
        } else {
          await api("/users", {
            method: "POST",
            body: JSON.stringify(payload),
          });
        }
        closeDialog();
        await loadAll();
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        saving.value = false;
      }
    };

    const deleteUser = async (user) => {
      if (!window.confirm(`确认删除用户 ${user.username}？`)) {
        return;
      }

      await api(`/users/${encodeURIComponent(user.sub)}`, { method: "DELETE" });
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

    const formatDate = (value) => (value ? new Date(value).toLocaleString() : "-");

    onMounted(loadAll);

    return {
      closeDialog,
      deleteUser,
      dialogMode,
      error,
      formatDate,
      keyword,
      loading,
      me,
      openCreate,
      openDetail,
      openEdit,
      probeToken,
      providers,
      saveUser,
      saving,
      selectedUser,
      setStatus,
      tokens,
      userForm,
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
            <div class="toolbar-actions">
              <button class="button" @click="openCreate">新增用户</button>
              <button class="button secondary" @click="loadAll">刷新</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>邮箱</th>
                  <th>Provider</th>
                  <th>组</th>
                  <th>角色</th>
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
                  <td>{{ (user.groups || []).join(', ') || '-' }}</td>
                  <td>{{ (user.roles || []).join(', ') || '-' }}</td>
                  <td><span class="badge">{{ user.status || 'active' }}</span></td>
                  <td>{{ formatDate(user.lastLoginAt) }}</td>
                  <td>
                    <div class="row-actions">
                      <button class="button secondary" @click="openDetail(user)">详情</button>
                      <button class="button secondary" @click="openEdit(user)">编辑</button>
                      <button v-if="(user.status || 'active') === 'active'" class="button danger" @click="setStatus(user, 'disabled')">禁用</button>
                      <button v-else class="button" @click="setStatus(user, 'active')">启用</button>
                      <button class="button danger" @click="deleteUser(user)">删除</button>
                    </div>
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
                  <td>{{ (provider.features || []).join(', ') || '-' }}</td>
                </tr>
                <tr v-for="provider in providers.apiProviders" :key="provider.provider">
                  <td>{{ provider.provider }}</td>
                  <td>Provider API</td>
                  <td><span class="badge">已注册</span></td>
                  <td>{{ provider.baseUrl }}</td>
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
                  <td>{{ formatDate(token.expiresAt) }}</td>
                  <td>{{ token.lastError || '-' }}</td>
                  <td><button class="button secondary" @click="probeToken(token)">探活</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <div v-if="dialogMode" class="modal" role="dialog" aria-modal="true">
        <form class="dialog" @submit.prevent="saveUser">
          <div class="dialog-head">
            <h2>{{ dialogMode === 'create' ? '新增用户' : dialogMode === 'edit' ? '编辑用户' : '用户详情' }}</h2>
            <button type="button" class="icon-button" aria-label="关闭" @click="closeDialog">×</button>
          </div>

          <dl v-if="dialogMode === 'detail'" class="details">
            <dt>Sub</dt><dd>{{ selectedUser?.sub }}</dd>
            <dt>用户名</dt><dd>{{ selectedUser?.username }}</dd>
            <dt>显示名</dt><dd>{{ selectedUser?.name }}</dd>
            <dt>邮箱</dt><dd>{{ selectedUser?.email }}</dd>
            <dt>Provider</dt><dd>{{ selectedUser?.authProvider }}</dd>
            <dt>外部 ID</dt><dd>{{ selectedUser?.externalId }}</dd>
            <dt>组</dt><dd>{{ (selectedUser?.groups || []).join(', ') || '-' }}</dd>
            <dt>角色</dt><dd>{{ (selectedUser?.roles || []).join(', ') || '-' }}</dd>
            <dt>状态</dt><dd>{{ selectedUser?.status || 'active' }}</dd>
            <dt>最近登录</dt><dd>{{ formatDate(selectedUser?.lastLoginAt) }}</dd>
            <dt>最近同步</dt><dd>{{ formatDate(selectedUser?.lastSyncedAt) }}</dd>
          </dl>

          <div v-else class="form-grid">
            <label>用户名<input v-model="userForm.username" required /></label>
            <label>显示名<input v-model="userForm.name" /></label>
            <label>邮箱<input v-model="userForm.email" type="email" /></label>
            <label>Provider<input v-model="userForm.authProvider" required /></label>
            <label>外部 ID<input v-model="userForm.externalId" /></label>
            <label>状态
              <select v-model="userForm.status">
                <option value="active">active</option>
                <option value="disabled">disabled</option>
                <option value="locked">locked</option>
                <option value="pending">pending</option>
              </select>
            </label>
            <label>用户组<input v-model="userForm.groups" placeholder="Owners, Developers" /></label>
            <label>角色<input v-model="userForm.roles" placeholder="admin, operator" /></label>
            <label>头像 URL<input v-model="userForm.picture" /></label>
            <label>手机号<input v-model="userForm.phone" /></label>
          </div>

          <div class="dialog-actions">
            <button type="button" class="button secondary" @click="closeDialog">关闭</button>
            <button v-if="dialogMode !== 'detail'" type="submit" class="button" :disabled="saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
}).mount("#app");
