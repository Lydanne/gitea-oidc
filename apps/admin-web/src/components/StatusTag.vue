<script setup lang="ts">
import Tag from "primevue/tag";
import type { TagSeverity } from "../types/admin";

/** 状态标签属性。 */
defineProps<{
  value?: string;
  severity?: TagSeverity;
}>();
</script>

<template>
  <Tag :value="value || '-'" :severity="severity ?? 'secondary'" class="status-tag" />
</template>

