<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Toolbar from "primevue/toolbar";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";
import { computed, onMounted, ref } from "vue";
import {
  createAdminApplication,
  disableAdminApplication,
  enableAdminApplication,
  fetchAdminApplications,
} from "../api/adminApi";
import ApplicationCredentialDetails from "../components/ApplicationCredentialDetails.vue";
import ApplicationFormFields from "../components/ApplicationFormFields.vue";
import StatusTag from "../components/StatusTag.vue";
import { useAdminDashboardContext } from "../composables/adminDashboardContext";
import type {
  ApplicationDetails,
  ApplicationForm,
  ApplicationStatusV1,
  CreateCustomApplicationOutcomeResponseV1,
  CreateCustomApplicationRequestV1,
  TagSeverity,
} from "../types/admin";

type ApplicationEnvironment = "development" | "staging" | "production";

const environmentOptions: Array<{ label: string; value: ApplicationEnvironment }> = [
  { label: "开发环境", value: "development" },
  { label: "预发布环境", value: "staging" },
  { label: "生产环境", value: "production" },
];

const createBlankForm = (): ApplicationForm => ({
  name: "",
  slug: "",
  environment: "development",
  clientType: "confidential",
  redirectUris: "http://localhost:3000/auth/callback",
  scopes: "openid profile email",
  refreshToken: false,
});

const confirm = useConfirm();
const toast = useToast();
const { setError } = useAdminDashboardContext();
const applications = ref<ApplicationDetails[]>([]);
const loading = ref(false);
const keyword = ref("");
const createDialogVisible = ref(false);
const credentialDialogVisible = ref(false);
const saving = ref(false);
const busyApplicationId = ref("");
const formError = ref("");
const applicationForm = ref<ApplicationForm>(createBlankForm());
const createdResult = ref<CreateCustomApplicationOutcomeResponseV1 | null>(null);
const lastSubmission = ref<{ payload: string; idempotencyKey: string } | null>(null);

/** 应用名称、slug 或 client_id 的本地搜索结果。 */
const visibleApplications = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return applications.value;

  return applications.value.filter(({ application, clients }) =>
    [
      application.name,
      application.slug,
      application.status,
      ...clients.map((client) => client.clientId),
    ].some((value) => value.toLowerCase().includes(query)),
  );
});

/** 将空格、逗号或换行分隔的输入规范化为去重列表。 */
const parseList = (value: string) => [
  ...new Set(
    value
      .split(/[\s,]+/u)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

/** 使用 Web Crypto 生成 UUID v4，不依赖安全上下文中的 randomUUID。 */
const createIdempotencyKey = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hexadecimal = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return [
    hexadecimal.slice(0, 4).join(""),
    hexadecimal.slice(4, 6).join(""),
    hexadecimal.slice(6, 8).join(""),
    hexadecimal.slice(8, 10).join(""),
    hexadecimal.slice(10).join(""),
  ].join("-");
};

/** 校验并创建后台 API 使用的自定义应用请求。 */
const buildCreatePayload = (): CreateCustomApplicationRequestV1 => {
  const name = applicationForm.value.name.trim();
  const slug = applicationForm.value.slug.trim();
  const redirectUris = parseList(applicationForm.value.redirectUris);
  const scopes = parseList(applicationForm.value.scopes);

  if (!name) throw new Error("应用名称不能为空");
  if (name.length > 120) throw new Error("应用名称不能超过 120 个字符");
  if (slug && (slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))) {
    throw new Error("slug 只能包含小写字母、数字和单个连字符");
  }
  if (redirectUris.length === 0) throw new Error("至少需要一个 Redirect URI");
  if (!scopes.includes("openid")) throw new Error("Scopes 必须包含 openid");

  for (const redirectUri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new Error(`Redirect URI 不是有效的绝对地址：${redirectUri}`);
    }

    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    const allowsDevelopmentHttp =
      applicationForm.value.environment === "development" &&
      parsed.protocol === "http:" &&
      isLoopback;
    if (parsed.protocol !== "https:" && !allowsDevelopmentHttp) {
      throw new Error("Redirect URI 必须使用 HTTPS，开发环境仅允许 HTTP loopback 地址");
    }
    if (parsed.hash || parsed.username || parsed.password || redirectUri.includes("*")) {
      throw new Error("Redirect URI 不能包含通配符、fragment 或用户凭据");
    }
  }

  if (applicationForm.value.refreshToken && !scopes.includes("offline_access")) {
    scopes.push("offline_access");
  }

  return {
    schemaVersion: 1,
    application: {
      name,
      ...(slug ? { slug } : {}),
      environment: applicationForm.value.environment,
      trustLevel: "third_party",
      consentPolicy: "explicit",
    },
    client: {
      clientType: applicationForm.value.clientType,
      redirectUris,
      postLogoutRedirectUris: [],
      scopes,
      resources: [],
      refreshToken: applicationForm.value.refreshToken,
      providerApi: false,
      resourceServer: false,
      pkcePolicy: "required",
    },
    credentialDelivery: "direct",
  };
};

/** 将未知异常同步到页面错误区和操作提示。 */
const handleError = (error: unknown, summary = "操作失败") => {
  const message = error instanceof Error ? error.message : String(error);
  setError(message);
  toast.add({ severity: "error", summary, detail: message, life: 4200 });
};

/** 刷新应用列表。 */
const loadApplications = async () => {
  loading.value = true;
  try {
    applications.value = (await fetchAdminApplications()) ?? [];
    setError("");
  } catch (error) {
    handleError(error, "加载应用失败");
  } finally {
    loading.value = false;
  }
};

/** 打开全新的创建表单并清除旧的幂等上下文。 */
const openCreateDialog = () => {
  applicationForm.value = createBlankForm();
  formError.value = "";
  lastSubmission.value = null;
  createDialogVisible.value = true;
};

/** 创建应用，同一份载荷失败重试时复用同一个幂等键。 */
const createApplication = async () => {
  formError.value = "";
  let payload: CreateCustomApplicationRequestV1;
  try {
    payload = buildCreatePayload();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error);
    return;
  }

  const serializedPayload = JSON.stringify(payload);
  if (lastSubmission.value?.payload !== serializedPayload) {
    lastSubmission.value = {
      payload: serializedPayload,
      idempotencyKey: createIdempotencyKey(),
    };
  }

  saving.value = true;
  try {
    const result = await createAdminApplication(payload, lastSubmission.value.idempotencyKey);
    if (!result) return;

    createdResult.value = result;
    createDialogVisible.value = false;
    credentialDialogVisible.value = true;
    lastSubmission.value = null;
    await loadApplications();
    toast.add({
      severity: result.credentialDelivery.kind === "already_delivered" ? "warn" : "success",
      summary:
        result.credentialDelivery.kind === "already_delivered"
          ? "请求已处理，密钥未重复返回"
          : "应用已创建",
      life: 3200,
    });
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error);
    handleError(error, "创建应用失败");
  } finally {
    saving.value = false;
  }
};

/** 使用乐观版本号切换应用状态。 */
const updateApplicationStatus = async (details: ApplicationDetails, enabled: boolean) => {
  busyApplicationId.value = details.application.id;
  try {
    const update = enabled ? enableAdminApplication : disableAdminApplication;
    const expectedVersion =
      !enabled && details.application.status === "disabling"
        ? details.application.version - 1
        : details.application.version;
    const result = await update(details.application.id, expectedVersion);
    if (!result) return;

    const index = applications.value.findIndex(
      ({ application }) => application.id === details.application.id,
    );
    if (index >= 0) {
      applications.value = applications.value.map((item, itemIndex) =>
        itemIndex === index ? result : item,
      );
    }
    setError("");
    toast.add({
      severity: "success",
      summary: enabled ? "应用已启用" : "应用已禁用",
      life: 2400,
    });
  } catch (error) {
    handleError(error, enabled ? "启用应用失败" : "禁用应用失败");
  } finally {
    busyApplicationId.value = "";
  }
};

/** 禁用前要求管理员明确确认。 */
const confirmDisable = (details: ApplicationDetails) => {
  confirm.require({
    header: "禁用应用",
    message: `确认禁用应用 ${details.application.name}？它的 OIDC Client 将无法继续认证。`,
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "禁用",
    rejectLabel: "取消",
    acceptClass: "p-button-danger",
    accept: () => updateApplicationStatus(details, false),
  });
};

/** 复制连接参数或一次性凭据，不在日志中输出内容。 */
const copyValue = async (value: string, label: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ severity: "success", summary: `${label}已复制`, life: 1800 });
  } catch {
    toast.add({
      severity: "warn",
      summary: "无法访问剪贴板",
      detail: "请手动选择并复制该值。",
      life: 3200,
    });
  }
};

/** 关闭一次性凭据弹窗后立即清除前端内存中的结果。 */
const closeCredentialDialog = () => {
  credentialDialogVisible.value = false;
};

const clearCreatedResult = () => {
  createdResult.value = null;
};

const getStatusLabel = (status: ApplicationStatusV1) =>
  ({
    draft: "草稿",
    active: "已启用",
    disabling: "等待撤销",
    disabled: "已禁用",
    deleted: "已删除",
  })[status];

const getStatusSeverity = (status: ApplicationStatusV1): TagSeverity =>
  ({
    draft: "secondary",
    active: "success",
    disabling: "danger",
    disabled: "warn",
    deleted: "danger",
  })[status] as TagSeverity;

const getEnvironmentLabel = (environment: ApplicationEnvironment) =>
  environmentOptions.find((option) => option.value === environment)?.label ?? environment;

onMounted(loadApplications);
</script>

<template>
  <section class="content-panel">
    <Toolbar class="admin-toolbar">
      <template #start>
        <label class="sr-only" for="application-search">搜索应用</label>
        <InputText
          id="application-search"
          v-model="keyword"
          class="application-search"
          placeholder="搜索名称、slug、client_id 或状态"
        />
      </template>
      <template #end>
        <Button
          icon="pi pi-refresh"
          label="刷新列表"
          severity="secondary"
          outlined
          :loading="loading"
          @click="loadApplications"
        />
        <Button icon="pi pi-plus" label="创建应用" @click="openCreateDialog" />
      </template>
    </Toolbar>

    <DataTable
      :value="visibleApplications"
      data-key="application.id"
      paginator
      :rows="8"
      :rows-per-page-options="[8, 16, 32]"
      :loading="loading"
      striped-rows
      scrollable
      table-style="min-width: 74rem"
    >
      <Column header="应用" sortable sort-field="application.name" style="min-width: 15rem">
        <template #body="{ data }">
          <div class="stacked-cell">
            <strong>{{ data.application.name }}</strong>
            <small>{{ data.application.slug }}</small>
          </div>
        </template>
      </Column>
      <Column header="环境" sortable sort-field="application.environment" style="min-width: 8rem">
        <template #body="{ data }">
          {{ getEnvironmentLabel(data.application.environment) }}
        </template>
      </Column>
      <Column header="Client" style="min-width: 18rem">
        <template #body="{ data }">
          <div v-if="data.clients[0]" class="stacked-cell">
            <strong>{{ data.clients[0].clientId }}</strong>
            <small>{{ data.clients[0].clientType === "public" ? "公共客户端" : "机密客户端" }}</small>
          </div>
          <span v-else>-</span>
        </template>
      </Column>
      <Column header="Redirect URI" style="min-width: 21rem">
        <template #body="{ data }">
          <span class="text-break">{{ data.clients[0]?.redirectUris.join(", ") || "-" }}</span>
        </template>
      </Column>
      <Column header="Scopes" style="min-width: 15rem">
        <template #body="{ data }">
          {{ data.clients[0]?.allowedScopes.join(" ") || "-" }}
        </template>
      </Column>
      <Column header="状态" sortable sort-field="application.status" style="min-width: 8rem">
        <template #body="{ data }">
          <StatusTag
            :value="getStatusLabel(data.application.status)"
            :severity="getStatusSeverity(data.application.status)"
          />
        </template>
      </Column>
      <Column header="操作" style="min-width: 8rem">
        <template #body="{ data }">
          <span v-if="data.application.source.kind === 'system'" class="public-client-note">
            配置管理
          </span>
          <Button
            v-else-if="data.application.status === 'active'"
            icon="pi pi-ban"
            label="禁用"
            size="small"
            severity="warn"
            outlined
            :loading="busyApplicationId === data.application.id"
            :aria-label="`禁用应用 ${data.application.name}`"
            @click="confirmDisable(data)"
          />
          <Button
            v-else-if="data.application.status === 'disabling'"
            icon="pi pi-refresh"
            label="重试撤销"
            size="small"
            severity="danger"
            outlined
            :loading="busyApplicationId === data.application.id"
            :aria-label="`重试撤销应用 ${data.application.name} 的 OIDC 凭据`"
            @click="updateApplicationStatus(data, false)"
          />
          <Button
            v-else-if="data.application.status !== 'deleted'"
            icon="pi pi-check"
            label="启用"
            size="small"
            severity="success"
            outlined
            :loading="busyApplicationId === data.application.id"
            :aria-label="`启用应用 ${data.application.name}`"
            @click="updateApplicationStatus(data, true)"
          />
        </template>
      </Column>
      <template #empty>
        <div class="empty-state">{{ keyword ? "没有匹配的应用" : "暂无应用" }}</div>
      </template>
    </DataTable>
  </section>

  <Dialog
    v-model:visible="createDialogVisible"
    modal
    header="创建自定义应用"
    :draggable="false"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
  >
    <Message v-if="formError" severity="error" :closable="false" class="form-message">
      {{ formError }}
    </Message>

    <ApplicationFormFields v-model="applicationForm" @submit="createApplication" />

    <template #footer>
      <Button label="取消" severity="secondary" outlined @click="createDialogVisible = false" />
      <Button
        icon="pi pi-check"
        label="创建应用"
        :loading="saving"
        @click="createApplication"
      />
    </template>
  </Dialog>

  <Dialog
    v-model:visible="credentialDialogVisible"
    modal
    header="保存应用接入配置"
    :closable="false"
    :close-on-escape="false"
    :dismissable-mask="false"
    :draggable="false"
    :style="{ width: 'min(780px, calc(100vw - 32px))' }"
    @after-hide="clearCreatedResult"
  >
    <ApplicationCredentialDetails v-if="createdResult" :result="createdResult" @copy="copyValue" />

    <template #footer>
      <Button
        icon="pi pi-check"
        label="我已保存配置，关闭"
        severity="danger"
        @click="closeCredentialDialog"
      />
    </template>
  </Dialog>
</template>
