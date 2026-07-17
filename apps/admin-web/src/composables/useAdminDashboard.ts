import { computed, ref } from "vue";
import {
  createAdminUser,
  fetchAdminSession,
  fetchAdminUsers,
  fetchProviderState,
  fetchProviderTokens,
  probeProviderToken,
  removeAdminUser,
  updateAdminUser,
  updateAdminUserStatus,
} from "../api/adminApi";
import { adminRuntimeConfig } from "../runtimeConfig";
import type {
  AdminSession,
  AdminUser,
  AdminUserPayload,
  ProviderState,
  ProviderToken,
  UserStatus,
} from "../types/admin";

/** 管理台全局数据与写操作。 */
export const useAdminDashboard = () => {
  const loading = ref(true);
  const refreshing = ref(false);
  const error = ref("");
  const me = ref<AdminSession | null>(null);
  const users = ref<AdminUser[]>([]);
  const providers = ref<ProviderState>({
    authProviders: [],
    apiProviders: [],
  });
  const tokens = ref<ProviderToken[]>([]);
  const applicationsEnabled = computed(
    () =>
      me.value?.capabilities.applications ?? adminRuntimeConfig.capabilities.applications ?? false,
  );

  /** 加载管理台全部首屏数据。 */
  const loadAll = async (options: { silent?: boolean } = {}) => {
    if (options.silent) {
      refreshing.value = true;
    } else {
      loading.value = true;
    }
    error.value = "";

    try {
      const [sessionResult, usersResult, providerResult, tokenResult] = await Promise.all([
        fetchAdminSession(),
        fetchAdminUsers(),
        fetchProviderState(),
        fetchProviderTokens(),
      ]);

      me.value = sessionResult;
      users.value = usersResult ?? [];
      providers.value = providerResult ?? providers.value;
      tokens.value = tokenResult ?? [];
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  };

  /** 设置全局错误消息。 */
  const setError = (message: string) => {
    error.value = message;
  };

  /** 创建用户并刷新列表。 */
  const createUser = async (payload: AdminUserPayload) => {
    await createAdminUser(payload);
    await loadAll({ silent: true });
  };

  /** 更新用户并刷新列表。 */
  const updateUser = async (sub: string, payload: AdminUserPayload) => {
    await updateAdminUser(sub, payload);
    await loadAll({ silent: true });
  };

  /** 删除用户并刷新列表。 */
  const deleteUser = async (user: AdminUser) => {
    await removeAdminUser(user.sub);
    await loadAll({ silent: true });
  };

  /** 更新用户状态并刷新列表。 */
  const setUserStatus = async (user: AdminUser, status: UserStatus) => {
    await updateAdminUserStatus(user.sub, status);
    await loadAll({ silent: true });
  };

  /** 手动探活 token 并刷新列表。 */
  const probeToken = async (token: ProviderToken) => {
    await probeProviderToken(token);
    await loadAll({ silent: true });
  };

  return {
    loading,
    refreshing,
    error,
    me,
    users,
    providers,
    tokens,
    applicationsEnabled,
    loadAll,
    setError,
    createUser,
    updateUser,
    deleteUser,
    setUserStatus,
    probeToken,
  };
};

/** 管理台全局状态上下文类型。 */
export type AdminDashboardContext = ReturnType<typeof useAdminDashboard>;
