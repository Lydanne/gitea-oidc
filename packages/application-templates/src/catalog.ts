import { ApplicationTemplateFormV1Schema } from "@gitea-oidc/contracts";
import { createImmutableJsonSnapshot } from "./jsonSnapshot.js";
import type {
  ApplicationTemplateDefinition,
  ApplicationTemplatePreview,
  ApplicationTemplateReference,
  ApplicationTemplateResolution,
  ApplicationTemplateSummary,
  TemplateCatalog,
  TemplateResolutionContext,
} from "./types.js";

export type TemplateCatalogErrorCode =
  | "DUPLICATE_TEMPLATE"
  | "INVALID_TEMPLATE_DEFINITION"
  | "TEMPLATE_NOT_FOUND";

export class TemplateCatalogError extends Error {
  readonly code: TemplateCatalogErrorCode;

  constructor(code: TemplateCatalogErrorCode, message: string) {
    super(message);
    this.name = "TemplateCatalogError";
    this.code = code;
  }
}

const referenceKey = (reference: ApplicationTemplateReference): string =>
  `${reference.id}@${reference.version}`;

const referencesEqual = (
  left: ApplicationTemplateReference,
  right: ApplicationTemplateReference,
): boolean => left.id === right.id && left.version === right.version;

const assertResolvedReference = (
  requested: ApplicationTemplateReference,
  actual: ApplicationTemplateReference,
  stage: string,
): void => {
  if (!referencesEqual(requested, actual)) {
    throw new TemplateCatalogError(
      "INVALID_TEMPLATE_DEFINITION",
      `模板 ${referenceKey(requested)} 的 ${stage} 返回了不一致的模板引用`,
    );
  }
};

/** 创建构造完成后不可注册新模板的 catalog，避免运行时改变模板解析结果。 */
export function createTemplateCatalog(
  definitions: readonly ApplicationTemplateDefinition[],
): TemplateCatalog {
  const definitionsByReference = new Map<string, ApplicationTemplateDefinition>();
  const definitionsById = new Map<string, ApplicationTemplateDefinition[]>();

  for (const definition of definitions) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(definition.id) ||
      !Number.isSafeInteger(definition.version) ||
      definition.version < 1 ||
      !definition.name.trim() ||
      !definition.description.trim() ||
      definition.supportedVersions.length === 0 ||
      new Set(definition.supportedVersions).size !== definition.supportedVersions.length
    ) {
      throw new TemplateCatalogError(
        "INVALID_TEMPLATE_DEFINITION",
        `模板 ${referenceKey(definition)} 的声明无效`,
      );
    }

    const parsedForm = ApplicationTemplateFormV1Schema.safeParse(definition.form);
    if (!parsedForm.success) {
      throw new TemplateCatalogError(
        "INVALID_TEMPLATE_DEFINITION",
        `模板 ${referenceKey(definition)} 的表单声明无效`,
      );
    }
    const immutableDefinition = Object.freeze({
      ...definition,
      supportedVersions: Object.freeze([...definition.supportedVersions]),
      form: createImmutableJsonSnapshot(parsedForm.data),
    });
    const key = referenceKey(immutableDefinition);
    if (definitionsByReference.has(key)) {
      throw new TemplateCatalogError("DUPLICATE_TEMPLATE", `模板 ${key} 重复注册`);
    }
    definitionsByReference.set(key, immutableDefinition);
    const versions = definitionsById.get(immutableDefinition.id) ?? [];
    versions.push(immutableDefinition);
    definitionsById.set(immutableDefinition.id, versions);
  }

  for (const versions of definitionsById.values()) {
    versions.sort((left, right) => left.version - right.version);
    Object.freeze(versions);
  }

  const list = (): readonly ApplicationTemplateSummary[] =>
    Object.freeze(
      [...definitionsByReference.values()]
        .sort((left, right) =>
          left.id === right.id ? left.version - right.version : left.id.localeCompare(right.id),
        )
        .map((definition) =>
          Object.freeze({
            reference: Object.freeze({ id: definition.id, version: definition.version }),
            name: definition.name,
            description: definition.description,
            supportedVersions: Object.freeze([...definition.supportedVersions]),
            form: definition.form,
          }),
        ),
    );

  const get = (reference: ApplicationTemplateReference): ApplicationTemplateDefinition => {
    const definition = definitionsByReference.get(referenceKey(reference));
    if (!definition) {
      throw new TemplateCatalogError("TEMPLATE_NOT_FOUND", `找不到模板 ${referenceKey(reference)}`);
    }
    return definition;
  };

  const getLatest = (templateId: string): ApplicationTemplateDefinition => {
    const versions = definitionsById.get(templateId);
    const definition = versions?.at(-1);
    if (!definition) {
      throw new TemplateCatalogError("TEMPLATE_NOT_FOUND", `找不到模板 ${templateId}`);
    }
    return definition;
  };

  const preview = (
    reference: ApplicationTemplateReference,
    input: unknown,
    context: TemplateResolutionContext,
  ): ApplicationTemplatePreview => {
    const result = get(reference).preview(input, context);
    assertResolvedReference(reference, result.template, "preview");
    assertResolvedReference(reference, result.resolution.template, "preview resolution");
    return result;
  };

  const resolve = (
    reference: ApplicationTemplateReference,
    input: unknown,
    context: TemplateResolutionContext,
  ): ApplicationTemplateResolution => {
    const result = get(reference).resolve(input, context);
    assertResolvedReference(reference, result.template, "resolution");
    assertResolvedReference(reference, result.resolution.template, "resolution payload");
    assertResolvedReference(reference, result.snapshot.template, "snapshot");
    assertResolvedReference(reference, result.snapshot.resolution.template, "snapshot resolution");
    return result;
  };

  return Object.freeze({ list, get, getLatest, preview, resolve });
}
