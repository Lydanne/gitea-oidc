<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import type { IntegrationGuideV1 } from "../types/admin";

defineProps<{ guide: IntegrationGuideV1 }>();
defineEmits<{ copy: [value: string, label: string] }>();
</script>

<template>
  <article class="integration-guide">
    <header>
      <h2>{{ guide.title }}</h2>
      <p v-if="guide.description">{{ guide.description }}</p>
    </header>

    <template v-for="(node, index) in guide.nodes" :key="`${node.kind}-${index}`">
      <h3 v-if="node.kind === 'heading' && node.level === 2">{{ node.text }}</h3>
      <h4 v-else-if="node.kind === 'heading' && node.level === 3">{{ node.text }}</h4>
      <h5 v-else-if="node.kind === 'heading'">{{ node.text }}</h5>
      <p v-else-if="node.kind === 'paragraph'">{{ node.text }}</p>
      <dl v-else-if="node.kind === 'field'" class="guide-field">
        <dt>{{ node.label }}</dt>
        <dd>
          <code>{{ node.value }}</code>
          <Button
            v-if="node.copyable"
            icon="pi pi-copy"
            text
            rounded
            severity="secondary"
            :aria-label="`复制${node.label}`"
            @click="$emit('copy', node.value, node.label)"
          />
        </dd>
        <dd v-if="node.description" class="field-help">{{ node.description }}</dd>
      </dl>
      <figure v-else-if="node.kind === 'code'" class="guide-code">
        <figcaption v-if="node.caption">{{ node.caption }}</figcaption>
        <pre><code>{{ node.code }}</code></pre>
        <Button
          icon="pi pi-copy"
          label="复制命令"
          size="small"
          severity="secondary"
          outlined
          @click="$emit('copy', node.code, '命令')"
        />
      </figure>
      <Message v-else-if="node.kind === 'warning'" severity="warn" :closable="false">
        {{ node.text }}
      </Message>
      <ol v-else-if="node.kind === 'steps'" class="guide-steps">
        <li v-for="item in node.items" :key="item">{{ item }}</li>
      </ol>
    </template>
  </article>
</template>
