<script setup lang="ts">
import Checkbox from "primevue/checkbox";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import type { ApplicationForm } from "../types/admin";

const model = defineModel<ApplicationForm>({ required: true });

defineEmits<{
  submit: [];
}>();

const environmentOptions = [
  { label: "开发环境", value: "development" },
  { label: "预发布环境", value: "staging" },
  { label: "生产环境", value: "production" },
];

const clientTypeOptions = [
  { label: "机密客户端（服务端应用）", value: "confidential" },
  { label: "公共客户端（原生应用 / SPA）", value: "public" },
];
</script>

<template>
  <form class="application-form" @submit.prevent="$emit('submit')">
    <label class="field" for="application-name">
      <span>应用名称</span>
      <InputText
        id="application-name"
        v-model="model.name"
        autocomplete="off"
        maxlength="120"
        required
        autofocus
        placeholder="例如：内部工单系统"
      />
    </label>

    <label class="field" for="application-slug">
      <span>Slug（可选）</span>
      <InputText
        id="application-slug"
        v-model="model.slug"
        autocomplete="off"
        maxlength="80"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        aria-describedby="application-slug-help"
        placeholder="例如：internal-ticket"
      />
      <small id="application-slug-help" class="field-help">仅小写字母、数字和单个连字符</small>
    </label>

    <label class="field" for="application-environment">
      <span>运行环境</span>
      <Select
        input-id="application-environment"
        v-model="model.environment"
        :options="environmentOptions"
        option-label="label"
        option-value="value"
      />
    </label>

    <label class="field" for="application-client-type">
      <span>客户端类型</span>
      <Select
        input-id="application-client-type"
        v-model="model.clientType"
        :options="clientTypeOptions"
        option-label="label"
        option-value="value"
        aria-describedby="application-client-type-help"
      />
      <small id="application-client-type-help" class="field-help">
        公共客户端不会生成 client secret，并强制使用 PKCE S256
      </small>
    </label>

    <label class="field field-full" for="application-redirect-uris">
      <span>Redirect URI</span>
      <Textarea
        id="application-redirect-uris"
        v-model="model.redirectUris"
        rows="3"
        required
        aria-describedby="application-redirect-help"
        placeholder="每行一个完整回调地址"
      />
      <small id="application-redirect-help" class="field-help">
        每行一个；生产与预发布环境必须使用 HTTPS
      </small>
    </label>

    <label class="field field-full" for="application-scopes">
      <span>Scopes</span>
      <InputText
        id="application-scopes"
        v-model="model.scopes"
        required
        aria-describedby="application-scopes-help"
        placeholder="openid profile email"
      />
      <small id="application-scopes-help" class="field-help">
        使用空格、逗号或换行分隔，必须包含 <code>openid</code>
      </small>
    </label>

    <div class="field field-full checkbox-field">
      <Checkbox v-model="model.refreshToken" input-id="application-refresh-token" binary />
      <label for="application-refresh-token">
        启用 Refresh Token
        <small class="field-help">提交时会自动加入 <code>offline_access</code> scope</small>
      </label>
    </div>
  </form>
</template>
