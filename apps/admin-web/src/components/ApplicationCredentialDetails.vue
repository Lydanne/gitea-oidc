<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import type { CreateApplicationOutcomeResponse } from "../types/admin";

withDefaults(
  defineProps<{
    result: CreateApplicationOutcomeResponse;
    rotated?: boolean;
  }>(),
  { rotated: false },
);

defineEmits<{
  copy: [value: string, label: string];
}>();
</script>

<template>
  <div class="credential-panel">
    <Message
      v-if="result.credentialDelivery.kind === 'already_delivered'"
      severity="error"
      :closable="false"
    >
      该幂等请求已经成功创建应用，Client Secret 只在首次响应中交付，当前不会再次返回。
      如果首次响应丢失，请回到应用列表轮换密钥；列表中的当前版本可用于安全重试。
    </Message>
    <Message
      v-else-if="result.credentialDelivery.credential.kind === 'none'"
      severity="info"
      :closable="false"
    >
      公共客户端不会生成 Client Secret，请使用下方连接参数和 PKCE S256 接入。
    </Message>
    <Message v-else severity="warn" :closable="false">
      <template v-if="rotated">
        旧 Client Secret 已立即失效。新凭据只显示这一次，请立即保存到安全的密钥管理系统。
      </template>
      <template v-else>
        一次性凭据只会显示这一次。请立即复制并保存到安全的密钥管理系统，关闭后无法再次查看。
      </template>
    </Message>

    <dl class="connection-details">
      <dt>Issuer</dt>
      <dd>
        <code>{{ result.connection.issuer }}</code>
        <Button
          icon="pi pi-copy"
          text
          rounded
          severity="secondary"
          aria-label="复制 Issuer"
          @click="$emit('copy', result.connection.issuer, 'Issuer')"
        />
      </dd>

      <dt>Client ID</dt>
      <dd>
        <code>{{ result.connection.clientId }}</code>
        <Button
          icon="pi pi-copy"
          text
          rounded
          severity="secondary"
          aria-label="复制 Client ID"
          @click="$emit('copy', result.connection.clientId, 'Client ID')"
        />
      </dd>

      <dt>Client Secret</dt>
      <dd v-if="result.credentialDelivery.kind === 'already_delivered'">
        <span class="public-client-note">已在首次响应中交付，本次不再显示</span>
      </dd>
      <dd v-else>
        <template v-if="result.credentialDelivery.credential.kind === 'client_secret'">
          <code class="secret-value">{{ result.credentialDelivery.credential.clientSecret }}</code>
          <Button
            icon="pi pi-copy"
            label="复制密钥"
            size="small"
            severity="danger"
            outlined
            @click="
              $emit(
                'copy',
                result.credentialDelivery.credential.clientSecret,
                'Client Secret',
              )
            "
          />
        </template>
        <span v-else class="public-client-note">公共客户端不使用 Client Secret</span>
      </dd>

      <dt>Redirect URI</dt>
      <dd><code>{{ result.connection.redirectUris.join("\n") }}</code></dd>

      <template v-if="result.connection.postLogoutRedirectUris.length > 0">
        <dt>Post Logout Redirect URI</dt>
        <dd><code>{{ result.connection.postLogoutRedirectUris.join("\n") }}</code></dd>
      </template>

      <dt>Scopes</dt>
      <dd><code>{{ result.connection.scopes.join(" ") }}</code></dd>
    </dl>
  </div>
</template>
