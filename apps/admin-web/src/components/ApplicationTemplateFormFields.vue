<script setup lang="ts">
import Checkbox from "primevue/checkbox";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import { computed, watch } from "vue";
import type { ApplicationTemplateSummaryV1, TemplateApplicationForm } from "../types/admin";

const props = defineProps<{ templates: ApplicationTemplateSummaryV1[] }>();
const model = defineModel<TemplateApplicationForm>({ required: true });

defineEmits<{ submit: [] }>();

const templateOptions = computed(() =>
  props.templates.map((template) => ({
    label: `${template.name} · ${template.reference.id}@${template.reference.version}`,
    value: `${template.reference.id}@${template.reference.version}`,
  })),
);

const selectedTemplate = computed(() =>
  props.templates.find(
    (template) =>
      `${template.reference.id}@${template.reference.version}` === model.value.templateKey,
  ),
);

const resetTemplateInput = () => {
  const template = selectedTemplate.value;
  model.value.templateInput = Object.fromEntries(
    (template?.form.fields ?? []).map((field) => [field.name, field.defaultValue ?? ""]),
  );
};

const stringInputValue = (name: string): string => {
  const value = model.value.templateInput[name];
  return typeof value === "string" ? value : "";
};

const updateStringInput = (name: string, value: string | undefined) => {
  model.value.templateInput[name] = value ?? "";
};

const booleanInputValue = (name: string): boolean => model.value.templateInput[name] === true;

const updateBooleanInput = (name: string, value: boolean | undefined) => {
  model.value.templateInput[name] = value === true;
};

watch(
  () => model.value.templateKey,
  (current, previous) => {
    if (current !== previous) resetTemplateInput();
  },
);
</script>

<template>
  <form class="application-form" @submit.prevent="$emit('submit')">
    <label class="field field-full" for="template-reference">
      <span>应用模板</span>
      <Select
        input-id="template-reference"
        v-model="model.templateKey"
        :options="templateOptions"
        option-label="label"
        option-value="value"
      />
      <small v-if="selectedTemplate" class="field-help">{{ selectedTemplate.description }}</small>
    </label>

    <label class="field" for="template-application-name">
      <span>应用名称</span>
      <InputText
        id="template-application-name"
        v-model="model.name"
        maxlength="120"
        required
        autocomplete="off"
        placeholder="例如：研发代码平台"
      />
    </label>

    <label class="field" for="template-application-slug">
      <span>Slug（可选）</span>
      <InputText
        id="template-application-slug"
        v-model="model.slug"
        maxlength="80"
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        autocomplete="off"
        placeholder="例如：engineering-platform"
      />
    </label>

    <div
      v-for="field in selectedTemplate?.form.fields ?? []"
      :key="field.name"
      class="field"
      :class="{
        'field-full': field.kind === 'url' || field.kind === 'textarea',
        'checkbox-field': field.kind === 'checkbox',
      }"
    >
      <template v-if="field.kind === 'checkbox'">
        <Checkbox
          :input-id="`template-input-${field.name}`"
          :model-value="booleanInputValue(field.name)"
          @update:model-value="updateBooleanInput(field.name, $event)"
          binary
        />
        <label :for="`template-input-${field.name}`">
          <span>{{ field.label }}</span>
          <small v-if="field.description" class="field-help">{{ field.description }}</small>
        </label>
      </template>
      <template v-else>
        <label :for="`template-input-${field.name}`">
          <span>{{ field.label }}{{ field.required ? "" : "（可选）" }}</span>
        </label>
        <Select
          v-if="field.kind === 'select'"
          :input-id="`template-input-${field.name}`"
          v-model="model.templateInput[field.name]"
          :options="field.options"
          option-label="label"
          option-value="value"
        />
        <Textarea
          v-else-if="field.kind === 'textarea'"
          :id="`template-input-${field.name}`"
          :model-value="stringInputValue(field.name)"
          :rows="field.rows ?? 4"
          :required="field.required"
          :placeholder="field.placeholder"
          autocomplete="off"
          @update:model-value="updateStringInput(field.name, $event)"
        />
        <InputText
          v-else
          :id="`template-input-${field.name}`"
          :model-value="stringInputValue(field.name)"
          :type="field.kind === 'url' ? 'url' : 'text'"
          :required="field.required"
          :placeholder="field.placeholder"
          autocomplete="off"
          @update:model-value="updateStringInput(field.name, $event)"
        />
        <small v-if="field.description" class="field-help">{{ field.description }}</small>
      </template>
    </div>
  </form>
</template>
