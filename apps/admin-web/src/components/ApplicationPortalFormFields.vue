<script setup lang="ts">
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import type { ApplicationPortalForm } from "../types/admin";

const model = defineModel<ApplicationPortalForm>({ required: true });
</script>

<template>
  <div class="field field-full checkbox-field">
    <Checkbox v-model="model.enabled" input-id="application-portal-enabled" binary />
    <label for="application-portal-enabled">
      显示在用户门户
      <small class="field-help">启用后，已登录用户可以在门户中看到并打开该应用。</small>
    </label>
  </div>

  <template v-if="model.enabled">
    <label class="field field-full" for="application-portal-launch-url">
      <span>门户入口 URL</span>
      <InputText
        id="application-portal-launch-url"
        v-model="model.launchUrl"
        type="url"
        maxlength="2048"
        required
        autocomplete="off"
        aria-describedby="application-portal-launch-url-help"
        placeholder="https://app.example.com/"
      />
      <small id="application-portal-launch-url-help" class="field-help">
        必须是完整的 HTTP(S) 地址；生产和预发应用必须使用 HTTPS。
      </small>
    </label>

    <label class="field" for="application-portal-icon-url">
      <span>图标 URL（可选）</span>
      <InputText
        id="application-portal-icon-url"
        v-model="model.iconUrl"
        type="url"
        maxlength="2048"
        autocomplete="off"
        placeholder="https://app.example.com/icon.png"
      />
    </label>

    <label class="field" for="application-portal-order">
      <span>排序值</span>
      <InputNumber
        v-model="model.order"
        input-id="application-portal-order"
        :min="0"
        :max="1000000"
        :use-grouping="false"
        aria-describedby="application-portal-order-help"
      />
      <small id="application-portal-order-help" class="field-help">数值越小，在门户中越靠前。</small>
    </label>
  </template>
</template>
