<script setup lang="ts">
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import { type UserForm, userStatusOptions } from "../types/admin";

/** 用户表单双向模型。 */
const model = defineModel<UserForm>({ required: true });
defineProps<{ identityReadOnly?: boolean }>();
</script>

<template>
  <div class="form-grid">
    <label class="field">
      <span>用户名</span>
      <InputText v-model="model.username" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>显示名</span>
      <InputText v-model="model.name" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>邮箱</span>
      <InputText v-model="model.email" type="email" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>Provider</span>
      <InputText v-model="model.authProvider" :disabled="identityReadOnly" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>外部 ID</span>
      <InputText v-model="model.externalId" :disabled="identityReadOnly" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>状态</span>
      <Select
        v-model="model.status"
        :options="userStatusOptions"
        option-label="label"
        option-value="value"
        fluid
      />
    </label>
    <label class="field">
      <span>用户组树（JSON）</span>
      <Textarea
        v-model="model.groups"
        placeholder='[{ "id": "developers", "name": "研发组", "children": [] }]'
        autocomplete="off"
        rows="8"
        auto-resize
        fluid
      />
    </label>
    <label class="field">
      <span>角色</span>
      <InputText v-model="model.roles" placeholder="admin, operator" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>头像 URL</span>
      <InputText v-model="model.picture" autocomplete="off" fluid />
    </label>
    <label class="field">
      <span>手机号</span>
      <InputText v-model="model.phone" autocomplete="off" fluid />
    </label>
  </div>
</template>
