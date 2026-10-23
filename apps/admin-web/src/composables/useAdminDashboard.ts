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
  AdminUserListQuery,
  AdminUserPage,
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
  const userTotal = ref(0);
  const userListTotal = ref(0);
  const usersLoading = ref(false);
  const userListQuery = ref<AdminUserListQuery>({
    offset: 0,
    limit: 8,
    sortBy: "username",
    sortOrder: "asc",
  });
  const providers = ref<ProviderState>({
    authProviders: [],
    apiProviders: [],
  });
  const tokens = ref<ProviderToken[]>([]);
  const applicationsEnabled = computed(
    () =>
      me.value?.capabilities.applications ?? adminRuntimeConfig.capabilities.applications ?? false,
  );
  let userRequestSequence = 0;
  let lastSuccessfulUserListQuery: AdminUserListQuery = { ...userListQuery.value };

  /** 按当前服务端分页条件加载用户，忽略晚到的旧请求响应。 */
  const loadUsers = async (
    query: AdminUserListQuery = userListQuery.value,
  ): Promise<AdminUserPage | null> => {
    const normalizedQuery: AdminUserListQuery = {
      ...query,
      search: query.search?.trim() || undefined,
      offset: query.offset ?? 0,
      limit: query.limit ?? 8,
      sortBy: query.sortBy ?? "username",
      sortOrder: query.sortOrder ?? "asc",
    };
    userListQuery.value = normalizedQuery;
    usersLoading.value = true;
    const requestSequence = ++userRequestSequence;

    try {
      const page = await fetchAdminUsers(normalizedQuery);
      if (requestSequence === userRequestSequence) {
        users.value = page?.items ?? [];
        userListTotal.value = page?.total ?? 0;
        userTotal.value = page?.allTotal ?? 0;
        lastSuccessfulUserListQuery = { ...normalizedQuery };
        error.value = "";
      }
      return page;
    } catch (err) {
      if (requestSequence === userRequestSequence) {
        userListQuery.value = { ...lastSuccessfulUserListQuery };
        error.value = err instanceof Error ? err.message : String(err);
      }
      throw err;
    } finally {
      if (requestSequence === userRequestSequence) {
        usersLoading.value = false;
      }
    }
  };

  /** 加载管理台全部首屏数据。 */
  const loadAll = async (options: { silent?: boolean } = {}) => {
    if (options.silent) {
      refreshing.value = true;
    } else {
      loading.value = true;
    }
    error.value = "";

    try {
      const [sessionResult, , providerResult, tokenResult] = await Promise.all([
        fetchAdminSession(),
        loadUsers(),
        fetchProviderState(),
        fetchProviderTokens(),
      ]);

      me.value = sessionResult;
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

  /** 写操作后刷新当前页；删除末页最后一项时回退到前一页。 */
  const reloadUsersAfterMutation = async () => {
    const page = await loadUsers();
    const offset = userListQuery.value.offset ?? 0;
    const limit = userListQuery.value.limit ?? 8;
    if (page && page.items.length === 0 && page.total > 0 && offset > 0) {
      await loadUsers({
        ...userListQuery.value,
        offset: Math.max(0, offset - limit),
      });
    }
  };

  /** 设置全局错误消息。 */
  const setError = (message: string) => {
    error.value = message;
  };

  /** 创建用户并刷新列表。 */
  const createUser = async (payload: AdminUserPayload) => {
    await createAdminUser(payload);
    await reloadUsersAfterMutation();
  };

  /** 更新用户并刷新列表。 */
  const updateUser = async (sub: string, payload: AdminUserPayload) => {
    await updateAdminUser(sub, payload);
    await reloadUsersAfterMutation();
  };

  /** 删除用户并刷新列表。 */
  const deleteUser = async (user: AdminUser) => {
    await removeAdminUser(user.sub);
    await reloadUsersAfterMutation();
  };

  /** 更新用户状态并刷新列表。 */
  const setUserStatus = async (user: AdminUser, status: UserStatus) => {
    await updateAdminUserStatus(user.sub, status);
    await reloadUsersAfterMutation();
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
    userTotal,
    userListTotal,
    usersLoading,
    userListQuery,
    providers,
    tokens,
    applicationsEnabled,
    loadAll,
    loadUsers,
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
