<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import SelectButton from "primevue/selectbutton";
import Toolbar from "primevue/toolbar";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";
import { computed, onMounted, ref } from "vue";
import {
  createAdminApplication,
  createAdminTemplateApplication,
  disableAdminApplication,
  enableAdminApplication,
  fetchAdminApplicationConnection,
  fetchAdminApplicationIntegrationGuide,
  fetchAdminApplications,
  fetchAdminApplicationTemplates,
  previewAdminApplicationTemplate,
  rotateAdminApplicationSecret,
} from "../api/adminApi";
import ApplicationCredentialDetails from "../components/ApplicationCredentialDetails.vue";
import ApplicationFormFields from "../components/ApplicationFormFields.vue";
import ApplicationTemplateFormFields from "../components/ApplicationTemplateFormFields.vue";
import IntegrationGuideDetails from "../components/IntegrationGuideDetails.vue";
import StatusTag from "../components/StatusTag.vue";
import { useAdminDashboardContext } from "../composables/adminDashboardContext";
import type {
  ApplicationDetails,
  ApplicationForm,
  ApplicationStatusV1,
  ApplicationTemplatePreviewV1,
  ApplicationTemplateSummaryV1,
  CreateApplicationOutcomeResponse,
  CreateCustomApplicationRequestV1,
  CreateTemplateApplicationRequestV1,
  IntegrationGuideV1,
  TagSeverity,
  TemplateApplicationForm,
} from "../types/admin";
import {
  buildCustomApplicationRequest,
  buildTemplateApplicationRequest,
  toSafePortalLaunchUrl,
} from "../utils/applicationForm";

type ApplicationEnvironment = "development" | "staging" | "production";
type ApplicationCreateMode = "template" | "custom";

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
  redirectUris: "http://localhost:3000/oidc/callback",
  postLogoutRedirectUris: "",
  scopes: "openid profile email",
  refreshToken: false,
  portal: { enabled: false, launchUrl: "", iconUrl: "", order: 0 },
});

const createBlankTemplateForm = (
  availableTemplates: readonly ApplicationTemplateSummaryV1[] = [],
): TemplateApplicationForm => {
  const template = [...availableTemplates].sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name);
    return nameOrder === 0 ? right.reference.version - left.reference.version : nameOrder;
  })[0];
  return {
    name: "",
    slug: "",
    templateKey: template ? `${template.reference.id}@${template.reference.version}` : "",
    templateInput: Object.fromEntries(
      (template?.form.fields ?? []).map((field) => [field.name, field.defaultValue ?? ""]),
    ),
    portal: { enabled: false, launchUrl: "", iconUrl: "", order: 0 },
  };
};

const createModeOptions: Array<{ label: string; value: ApplicationCreateMode }> = [
  { label: "使用模板", value: "template" },
  { label: "自定义 OIDC", value: "custom" },
];

const confirm = useConfirm();
const toast = useToast();
const { setError } = useAdminDashboardContext();
const applications = ref<ApplicationDetails[]>([]);
const templates = ref<ApplicationTemplateSummaryV1[]>([]);
const loading = ref(false);
const keyword = ref("");
const createDialogVisible = ref(false);
const credentialDialogVisible = ref(false);
const guideDialogVisible = ref(false);
const previewDialogVisible = ref(false);
const saving = ref(false);
const busyApplicationId = ref("");
const rotatingApplicationId = ref("");
const downloadingApplicationId = ref("");
const loadingGuideApplicationId = ref("");
const formError = ref("");
const applicationForm = ref<ApplicationForm>(createBlankForm());
const templateForm = ref<TemplateApplicationForm>(createBlankTemplateForm());
const createMode = ref<ApplicationCreateMode>("template");
const createdResult = ref<CreateApplicationOutcomeResponse | null>(null);
const credentialOperation = ref<"create" | "rotate">("create");
const selectedGuide = ref<IntegrationGuideV1 | null>(null);
const templatePreview = ref<ApplicationTemplatePreviewV1 | null>(null);
const previewing = ref(false);
const lastSubmission = ref<{ payload: string; idempotencyKey: string } | null>(null);

const selectedTemplate = computed(() =>
  templates.value.find(
    (template) =>
      `${template.reference.id}@${template.reference.version}` === templateForm.value.templateKey,
  ),
);

/** 应用名称、slug 或 client_id 的本地搜索结果。 */
const visibleApplications = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return applications.value;

  return applications.value.filter(({ application, clients }) =>
    [
      application.name,
      application.slug,
      application.status,
      application.portal?.launchUrl ?? "",
      ...clients.map((client) => client.clientId),
    ].some((value) => value.toLowerCase().includes(query)),
  );
});

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
  return buildCustomApplicationRequest(applicationForm.value);
};

/** 根据服务端 form descriptor 构建只引用精确模板版本的创建请求。 */
const buildTemplateCreatePayload = (): CreateTemplateApplicationRequestV1 => {
  const template = selectedTemplate.value;
  if (!template) throw new Error("请选择一个可用的应用模板");
  return buildTemplateApplicationRequest(templateForm.value, template);
};

const previewTemplateApplication = async () => {
  formError.value = "";
  let payload: CreateTemplateApplicationRequestV1;
  try {
    payload = buildTemplateCreatePayload();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error);
    return;
  }

  previewing.value = true;
  try {
    const preview = await previewAdminApplicationTemplate({
      schemaVersion: 1,
      template: payload.template,
      templateInput: payload.templateInput,
    });
    if (!preview) return;
    templatePreview.value = preview;
    previewDialogVisible.value = true;
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error);
    handleError(error, "预览模板失败");
  } finally {
    previewing.value = false;
  }
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

const loadTemplates = async () => {
  try {
    templates.value = (await fetchAdminApplicationTemplates()) ?? [];
  } catch (error) {
    handleError(error, "加载应用模板失败");
  }
};

/** 打开全新的创建表单并清除旧的幂等上下文。 */
const openCreateDialog = () => {
  applicationForm.value = createBlankForm();
  templateForm.value = createBlankTemplateForm(templates.value);
  createMode.value = templates.value.length > 0 ? "template" : "custom";
  formError.value = "";
  lastSubmission.value = null;
  createDialogVisible.value = true;
};

/** 创建应用，同一份载荷失败重试时复用同一个幂等键。 */
const createApplication = async () => {
  formError.value = "";
  let payload: CreateCustomApplicationRequestV1 | CreateTemplateApplicationRequestV1;
  try {
    payload = createMode.value === "template" ? buildTemplateCreatePayload() : buildCreatePayload();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error);
    return;
  }

  const serializedPayload = JSON.stringify({ mode: createMode.value, payload });
  if (lastSubmission.value?.payload !== serializedPayload) {
    lastSubmission.value = {
      payload: serializedPayload,
      idempotencyKey: createIdempotencyKey(),
    };
  }

  saving.value = true;
  try {
    const result =
      createMode.value === "template"
        ? await createAdminTemplateApplication(
            payload as CreateTemplateApplicationRequestV1,
            lastSubmission.value.idempotencyKey,
          )
        : await createAdminApplication(
            payload as CreateCustomApplicationRequestV1,
            lastSubmission.value.idempotencyKey,
          );
    if (!result) return;

    createdResult.value = result;
    credentialOperation.value = "create";
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

const canRotateApplicationSecret = (details: ApplicationDetails) =>
  details.application.source.kind !== "system" &&
  details.clients[0]?.clientType === "confidential" &&
  ["active", "disabled"].includes(details.application.status);

/** 轮换响应丢失时刷新当前 version，管理员可以直接再次轮换恢复。 */
const rotateApplicationSecret = async (details: ApplicationDetails) => {
  rotatingApplicationId.value = details.application.id;
  try {
    const result = await rotateAdminApplicationSecret(details.application.id, {
      schemaVersion: 1,
      expectedVersion: details.application.version,
    });
    if (!result) return;

    createdResult.value = result;
    credentialOperation.value = "rotate";
    credentialDialogVisible.value = true;
    await loadApplications();
    toast.add({ severity: "success", summary: "Client Secret 已轮换", life: 2600 });
  } catch (error) {
    await loadApplications();
    const message = error instanceof Error ? error.message : String(error);
    setError(message);
    toast.add({
      severity: "error",
      summary: "轮换结果未确认",
      detail: `${message}。列表已刷新；如果服务端已提交，请使用最新版本再次轮换。`,
      life: 5200,
    });
  } finally {
    rotatingApplicationId.value = "";
  }
};

const confirmRotateApplicationSecret = (details: ApplicationDetails) => {
  confirm.require({
    header: "轮换 Client Secret",
    message: `确认轮换应用 ${details.application.name} 的 Client Secret？旧密钥会立即失效。`,
    icon: "pi pi-key",
    acceptLabel: "轮换密钥",
    rejectLabel: "取消",
    acceptClass: "p-button-danger",
    accept: () => rotateApplicationSecret(details),
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

/** 只在浏览器内生成临时 URL，下载结束后立即释放。 */
const downloadJson = (value: unknown, filename: string) => {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
};

const connectionFilename = (application: ApplicationDetails["application"]) =>
  `${application.slug || application.id}.gitea-oidc.connection.json`;

/** 公开 connection 可重复下载，响应中不包含任何凭据。 */
const downloadApplicationConnection = async (details: ApplicationDetails) => {
  downloadingApplicationId.value = details.application.id;
  try {
    const connection = await fetchAdminApplicationConnection(details.application.id);
    if (!connection) return;
    downloadJson(connection, connectionFilename(details.application));
    toast.add({ severity: "success", summary: "连接配置已下载", life: 1800 });
  } catch (error) {
    handleError(error, "下载连接配置失败");
  } finally {
    downloadingApplicationId.value = "";
  }
};

const showApplicationGuide = async (details: ApplicationDetails) => {
  loadingGuideApplicationId.value = details.application.id;
  try {
    const guide = await fetchAdminApplicationIntegrationGuide(details.application.id);
    if (!guide) return;
    selectedGuide.value = guide;
    guideDialogVisible.value = true;
  } catch (error) {
    handleError(error, "加载接入说明失败");
  } finally {
    loadingGuideApplicationId.value = "";
  }
};

const downloadCreatedConnection = () => {
  const result = createdResult.value;
  if (!result) return;
  downloadJson(result.connection, connectionFilename(result.application));
};

/** 一次性 credential 文件只在创建响应仍驻留内存时允许下载。 */
const downloadCreatedCredential = () => {
  const result = createdResult.value;
  if (
    !result ||
    result.credentialDelivery.kind !== "direct" ||
    result.credentialDelivery.credential.kind !== "client_secret"
  ) {
    return;
  }
  downloadJson(
    result.credentialDelivery.credential,
    `${result.application.slug || result.application.id}.gitea-oidc.credential.json`,
  );
};

/** 关闭一次性凭据弹窗后立即清除前端内存中的结果。 */
const closeCredentialDialog = () => {
  credentialDialogVisible.value = false;
};

const clearCreatedResult = () => {
  createdResult.value = null;
  credentialOperation.value = "create";
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

const getSourceLabel = (application: ApplicationDetails["application"]) => {
  if (application.source.kind === "template") {
    return `${application.source.templateId}@${application.source.templateVersion}`;
  }
  return application.source.kind === "custom" ? "自定义" : "系统配置";
};

const getPortalStatus = (application: ApplicationDetails["application"]) => {
  if (!application.portal) return { label: "未配置", severity: "secondary" as const };
  if (!application.portal.enabled) return { label: "已隐藏", severity: "secondary" as const };
  if (application.status !== "active") return { label: "等待应用启用", severity: "warn" as const };
  return { label: "已显示", severity: "success" as const };
};

const getPortalLaunchUrl = (application: ApplicationDetails["application"]): string | null =>
  application.portal?.enabled
    ? toSafePortalLaunchUrl(application.portal.launchUrl, application.environment)
    : null;

onMounted(() => {
  void Promise.all([loadApplications(), loadTemplates()]);
});
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
      table-style="min-width: 86rem"
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
      <Column header="来源" style="min-width: 8rem">
        <template #body="{ data }">
          {{ getSourceLabel(data.application) }}
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
      <Column header="用户门户" style="min-width: 10rem">
        <template #body="{ data }">
          <div class="stacked-cell">
            <StatusTag
              :value="getPortalStatus(data.application).label"
              :severity="getPortalStatus(data.application).severity"
            />
            <a
              v-if="getPortalLaunchUrl(data.application)"
              class="portal-launch-link"
              :href="getPortalLaunchUrl(data.application) ?? undefined"
              target="_blank"
              rel="noopener noreferrer"
            >
              打开入口
              <span class="sr-only">：{{ data.application.name }}</span>
            </a>
          </div>
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
      <Column header="操作" style="min-width: 32rem">
        <template #body="{ data }">
          <div class="row-actions">
            <Button
              icon="pi pi-download"
              label="配置"
              size="small"
              severity="secondary"
              outlined
              :loading="downloadingApplicationId === data.application.id"
              :aria-label="`下载应用 ${data.application.name} 的公开连接配置`"
              @click="downloadApplicationConnection(data)"
            />
            <Button
              icon="pi pi-book"
              label="接入说明"
              size="small"
              severity="secondary"
              outlined
              :loading="loadingGuideApplicationId === data.application.id"
              :aria-label="`查看应用 ${data.application.name} 的接入说明`"
              @click="showApplicationGuide(data)"
            />
            <Button
              v-if="canRotateApplicationSecret(data)"
              icon="pi pi-key"
              label="轮换密钥"
              size="small"
              severity="danger"
              outlined
              :loading="rotatingApplicationId === data.application.id"
              :aria-label="`轮换应用 ${data.application.name} 的 Client Secret`"
              @click="confirmRotateApplicationSecret(data)"
            />
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
          </div>
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
    header="创建应用"
    :draggable="false"
    :style="{ width: 'min(760px, calc(100vw - 32px))' }"
  >
    <Message v-if="formError" severity="error" :closable="false" class="form-message">
      {{ formError }}
    </Message>

    <div class="application-create-mode">
      <span>创建方式</span>
      <SelectButton
        v-model="createMode"
        :options="createModeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />
      <small v-if="createMode === 'template'" class="field-help">
        模板会生成经过约束的 OIDC Client，并在创建后给出 Gitea 管理后台与 CLI 配置说明。
      </small>
      <small v-else class="field-help">
        自定义模式适合未内置支持的系统，请自行确认回调、Scope 与 PKCE 兼容性。
      </small>
    </div>

    <ApplicationTemplateFormFields
      v-if="createMode === 'template' && templates.length > 0"
      v-model="templateForm"
      :templates="templates"
      @submit="createApplication"
    />
    <Message
      v-else-if="createMode === 'template'"
      severity="warn"
      :closable="false"
      class="form-message"
    >
      当前服务端没有可用模板，请切换到自定义 OIDC。
    </Message>
    <ApplicationFormFields v-else v-model="applicationForm" @submit="createApplication" />

    <template #footer>
      <Button label="取消" severity="secondary" outlined @click="createDialogVisible = false" />
      <Button
        v-if="createMode === 'template'"
        icon="pi pi-eye"
        label="预览配置"
        severity="secondary"
        outlined
        :loading="previewing"
        @click="previewTemplateApplication"
      />
      <Button
        icon="pi pi-check"
        label="创建应用"
        :loading="saving"
        @click="createApplication"
      />
    </template>
  </Dialog>

  <Dialog
    v-model:visible="previewDialogVisible"
    modal
    header="模板配置预览"
    :draggable="false"
    :style="{ width: 'min(860px, calc(100vw - 32px))' }"
    @after-hide="templatePreview = null"
  >
    <dl v-if="templatePreview" class="connection-details">
      <dt>Issuer</dt>
      <dd><code>{{ templatePreview.issuer }}</code></dd>
      <dt>Redirect URI</dt>
      <dd><code>{{ templatePreview.client.redirectUris.join("\n") }}</code></dd>
      <template v-if="templatePreview.client.postLogoutRedirectUris.length > 0">
        <dt>Post Logout Redirect URI</dt>
        <dd>
          <code>{{ templatePreview.client.postLogoutRedirectUris.join("\n") }}</code>
        </dd>
      </template>
      <dt>Scopes</dt>
      <dd><code>{{ templatePreview.client.scopes.join(" ") }}</code></dd>
      <dt>PKCE</dt>
      <dd><code>{{ templatePreview.client.pkcePolicy }}</code></dd>
    </dl>
    <IntegrationGuideDetails
      v-if="templatePreview"
      :guide="templatePreview.integrationGuide"
      @copy="copyValue"
    />
  </Dialog>

  <Dialog
    v-model:visible="credentialDialogVisible"
    modal
    :header="credentialOperation === 'rotate' ? '保存新的 Client Secret' : '保存应用接入配置'"
    :closable="false"
    :close-on-escape="false"
    :dismissable-mask="false"
    :draggable="false"
    :style="{ width: 'min(780px, calc(100vw - 32px))' }"
    @after-hide="clearCreatedResult"
  >
    <ApplicationCredentialDetails
      v-if="createdResult"
      :result="createdResult"
      :rotated="credentialOperation === 'rotate'"
      @copy="copyValue"
    />
    <IntegrationGuideDetails
      v-if="createdResult"
      :guide="createdResult.integrationGuide"
      @copy="copyValue"
    />

    <template #footer>
      <Button
        icon="pi pi-download"
        label="下载连接配置"
        severity="secondary"
        outlined
        @click="downloadCreatedConnection"
      />
      <Button
        v-if="
          createdResult?.credentialDelivery.kind === 'direct' &&
          createdResult.credentialDelivery.credential.kind === 'client_secret'
        "
        icon="pi pi-key"
        label="下载一次性凭据"
        severity="warn"
        outlined
        @click="downloadCreatedCredential"
      />
      <Button
        icon="pi pi-check"
        label="我已保存配置，关闭"
        severity="danger"
        @click="closeCredentialDialog"
      />
    </template>
  </Dialog>

  <Dialog
    v-model:visible="guideDialogVisible"
    modal
    header="应用接入说明"
    :draggable="false"
    :style="{ width: 'min(860px, calc(100vw - 32px))' }"
    @after-hide="selectedGuide = null"
  >
    <IntegrationGuideDetails v-if="selectedGuide" :guide="selectedGuide" @copy="copyValue" />
  </Dialog>
</template>
