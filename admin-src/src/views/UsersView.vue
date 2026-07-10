<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Toolbar from "primevue/toolbar";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";
import { computed, ref } from "vue";
import StatusTag from "../components/StatusTag.vue";
import UserDetailList from "../components/UserDetailList.vue";
import UserFormFields from "../components/UserFormFields.vue";
import { useAdminDashboardContext } from "../composables/adminDashboardContext";
import type { AdminUser, UserForm, UserStatus } from "../types/admin";
import { userStatusOptions } from "../types/admin";
import { formatDate, getUserDisplayName, getUserStatusSeverity } from "../utils/format";
import { createBlankUserForm, formToPayload, userToForm } from "../utils/userForm";

const confirm = useConfirm();
const toast = useToast();
const { users, createUser, updateUser, deleteUser, setUserStatus, setError } =
  useAdminDashboardContext();
const keyword = ref("");
const statusFilter = ref<UserStatus | null>(null);
const dialogVisible = ref(false);
const dialogMode = ref<"create" | "detail" | "edit">("create");
const selectedUser = ref<AdminUser | null>(null);
const userForm = ref<UserForm>(createBlankUserForm());
const saving = ref(false);
const busySub = ref("");

/** 当前过滤后的用户列表。 */
const visibleUsers = computed(() => {
  const q = keyword.value.trim().toLowerCase();

  return users.value.filter((user) => {
    const matchesKeyword =
      !q ||
      [user.username, user.name, user.email, user.authProvider, user.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    const matchesStatus = !statusFilter.value || (user.status ?? "active") === statusFilter.value;

    return matchesKeyword && matchesStatus;
  });
});

/** 用户弹窗标题。 */
const dialogTitle = computed(() => {
  if (dialogMode.value === "create") return "新增用户";
  if (dialogMode.value === "edit") return "编辑用户";
  return "用户详情";
});

/** 统一处理视图操作异常。 */
const handleError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  setError(message);
  toast.add({ severity: "error", summary: "操作失败", detail: message, life: 3600 });
};

/** 打开创建用户弹窗。 */
const openCreate = () => {
  selectedUser.value = null;
  userForm.value = createBlankUserForm();
  dialogMode.value = "create";
  dialogVisible.value = true;
};

/** 打开用户详情弹窗。 */
const openDetail = (user: AdminUser) => {
  selectedUser.value = user;
  userForm.value = userToForm(user);
  dialogMode.value = "detail";
  dialogVisible.value = true;
};

/** 打开编辑用户弹窗。 */
const openEdit = (user: AdminUser) => {
  selectedUser.value = user;
  userForm.value = userToForm(user);
  dialogMode.value = "edit";
  dialogVisible.value = true;
};

/** 保存创建或编辑后的用户。 */
const saveUser = async () => {
  const payload = formToPayload(userForm.value, { includeIdentity: dialogMode.value !== "edit" });
  if (!payload.username) {
    handleError(new Error("用户名不能为空"));
    return;
  }

  saving.value = true;
  try {
    if (dialogMode.value === "edit" && selectedUser.value) {
      await updateUser(selectedUser.value.sub, payload);
    } else {
      await createUser(payload);
    }

    dialogVisible.value = false;
    toast.add({ severity: "success", summary: "已保存用户", life: 2400 });
  } catch (err) {
    handleError(err);
  } finally {
    saving.value = false;
  }
};

/** 确认并删除用户。 */
const confirmDelete = (user: AdminUser) => {
  confirm.require({
    header: "删除用户",
    message: `确认删除用户 ${getUserDisplayName(user)}？`,
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "删除",
    rejectLabel: "取消",
    acceptClass: "p-button-danger",
    accept: async () => {
      busySub.value = user.sub;
      try {
        await deleteUser(user);
        toast.add({ severity: "success", summary: "已删除用户", life: 2400 });
      } catch (err) {
        handleError(err);
      } finally {
        busySub.value = "";
      }
    },
  });
};

/** 切换用户状态。 */
const setStatus = async (user: AdminUser, status: UserStatus) => {
  busySub.value = user.sub;
  try {
    await setUserStatus(user, status);
    toast.add({ severity: "success", summary: "状态已更新", life: 2200 });
  } catch (err) {
    handleError(err);
  } finally {
    busySub.value = "";
  }
};
</script>

<template>
  <section class="content-panel">
    <Toolbar class="admin-toolbar">
      <template #start>
        <IconField class="search-field">
          <InputIcon class="pi pi-search" />
          <InputText v-model="keyword" placeholder="搜索用户名、邮箱、Provider 或状态" />
        </IconField>
        <Select
          v-model="statusFilter"
          :options="userStatusOptions"
          option-label="label"
          option-value="value"
          placeholder="全部状态"
          show-clear
          class="status-filter"
        />
      </template>
      <template #end>
        <Button icon="pi pi-plus" label="新增用户" @click="openCreate" />
      </template>
    </Toolbar>

    <DataTable
      :value="visibleUsers"
      data-key="sub"
      paginator
      :rows="8"
      :rows-per-page-options="[8, 16, 32]"
      striped-rows
      scrollable
      table-style="min-width: 68rem"
    >
      <Column header="用户" sortable sort-field="username" style="min-width: 15rem">
        <template #body="{ data }">
          <div class="identity-cell">
            <span class="avatar-fallback">{{ (data.name || data.username || '?').slice(0, 1) }}</span>
            <span>
              <strong>{{ data.name || data.username || "-" }}</strong>
              <small>{{ data.username || data.sub }}</small>
            </span>
          </div>
        </template>
      </Column>
      <Column field="email" header="邮箱" sortable style="min-width: 15rem" />
      <Column field="authProvider" header="Provider" sortable style="min-width: 8rem" />
      <Column header="组" style="min-width: 12rem">
        <template #body="{ data }">{{ (data.groups || []).join(", ") || "-" }}</template>
      </Column>
      <Column header="角色" style="min-width: 10rem">
        <template #body="{ data }">{{ (data.roles || []).join(", ") || "-" }}</template>
      </Column>
      <Column header="状态" sortable sort-field="status" style="min-width: 8rem">
        <template #body="{ data }">
          <StatusTag :value="data.status || 'active'" :severity="getUserStatusSeverity(data.status)" />
        </template>
      </Column>
      <Column header="最近登录" sortable sort-field="lastLoginAt" style="min-width: 12rem">
        <template #body="{ data }">{{ formatDate(data.lastLoginAt) }}</template>
      </Column>
      <Column header="操作" style="min-width: 15rem">
        <template #body="{ data }">
          <div class="row-actions">
            <Button
              icon="pi pi-eye"
              text
              rounded
              severity="secondary"
              aria-label="详情"
              @click="openDetail(data)"
            />
            <Button
              icon="pi pi-pencil"
              text
              rounded
              severity="secondary"
              aria-label="编辑"
              @click="openEdit(data)"
            />
            <Button
              v-if="(data.status || 'active') === 'active'"
              icon="pi pi-ban"
              text
              rounded
              severity="warn"
              aria-label="禁用"
              :loading="busySub === data.sub"
              @click="setStatus(data, 'disabled')"
            />
            <Button
              v-else
              icon="pi pi-check"
              text
              rounded
              severity="success"
              aria-label="启用"
              :loading="busySub === data.sub"
              @click="setStatus(data, 'active')"
            />
            <Button
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              aria-label="删除"
              :loading="busySub === data.sub"
              @click="confirmDelete(data)"
            />
          </div>
        </template>
      </Column>
      <template #empty>
        <div class="empty-state">没有匹配的用户</div>
      </template>
    </DataTable>
  </section>

  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="dialogTitle"
    :draggable="false"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
  >
    <UserDetailList v-if="dialogMode === 'detail'" :user="selectedUser" />
    <UserFormFields
      v-else
      v-model="userForm"
      :identity-read-only="dialogMode === 'edit'"
    />

    <template #footer>
      <Button label="关闭" severity="secondary" outlined @click="dialogVisible = false" />
      <Button
        v-if="dialogMode !== 'detail'"
        icon="pi pi-check"
        label="保存"
        :loading="saving"
        @click="saveUser"
      />
    </template>
  </Dialog>
</template>
