import {
  type ApplicationPortalInputV1,
  type ApplicationTemplateSummaryV1,
  type CreateCustomApplicationRequestV1,
  type CreateTemplateApplicationRequestV1,
  portalUrlSchema,
  safeParseCreateCustomApplicationRequestV1,
  safeParseCreateTemplateApplicationRequestV1,
} from "@x-oidc/contracts";
import type {
  ApplicationForm,
  ApplicationPortalForm,
  TemplateApplicationForm,
} from "../types/admin";

/** 将空格、逗号或换行分隔的表单值规范化为去重列表。 */
export const parseApplicationFormList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,]+/u)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

const formatContractError = (result: {
  error: { issues: Array<{ path: PropertyKey[]; message: string }> };
}) => {
  const issue = result.error.issues[0];
  const path = issue?.path.join(".");
  return issue ? `${path ? `${path}：` : ""}${issue.message}` : "应用配置无效";
};

/** 只在启用用户门户时构建完整的展示配置。 */
export const buildApplicationPortalInput = (
  form: ApplicationPortalForm,
): ApplicationPortalInputV1 | undefined => {
  if (!form.enabled) return undefined;

  const launchUrl = form.launchUrl.trim();
  const iconUrl = form.iconUrl.trim();
  if (!launchUrl) throw new Error("门户入口 URL 不能为空");
  if (!Number.isInteger(form.order) || form.order < 0 || form.order > 1_000_000) {
    throw new Error("门户排序值必须是 0 到 1000000 之间的整数");
  }

  return {
    enabled: true,
    launchUrl,
    ...(iconUrl ? { iconUrl } : {}),
    order: form.order,
  };
};

/** 防御性校验服务端返回的门户入口，避免不安全协议进入 href。 */
export const toSafePortalLaunchUrl = (
  value: unknown,
  environment: "development" | "staging" | "production" = "production",
): string | null => {
  const result = portalUrlSchema.safeParse(value);
  if (!result.success) return null;

  try {
    const url = new URL(result.data);
    if (url.protocol === "http:") {
      const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
      const octets = hostname.split(".");
      const loopback =
        hostname === "localhost" ||
        hostname === "::1" ||
        (octets.length === 4 &&
          octets[0] === "127" &&
          octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) <= 255));
      if (environment !== "development" || !loopback) return null;
    }
    return url.href;
  } catch {
    return null;
  }
};

/** 使用共享 contract 构建并校验后台 API 请求，避免页面复制协议规则。 */
export const buildCustomApplicationRequest = (
  form: ApplicationForm,
): CreateCustomApplicationRequestV1 => {
  const scopes = parseApplicationFormList(form.scopes);
  const portal = buildApplicationPortalInput(form.portal);
  if (form.refreshToken && !scopes.includes("offline_access")) {
    scopes.push("offline_access");
  }

  const result = safeParseCreateCustomApplicationRequestV1({
    schemaVersion: 1,
    application: {
      name: form.name,
      ...(form.slug.trim() === "" ? {} : { slug: form.slug }),
      environment: form.environment,
      ...(portal ? { portal } : {}),
      trustLevel: "third_party",
      consentPolicy: "explicit",
    },
    client: {
      clientType: form.clientType,
      redirectUris: parseApplicationFormList(form.redirectUris),
      postLogoutRedirectUris: parseApplicationFormList(form.postLogoutRedirectUris),
      scopes,
      resources: [],
      refreshToken: form.refreshToken,
      providerApi: false,
      resourceServer: false,
      pkcePolicy: "required",
    },
    credentialDelivery: "direct",
  });

  if (!result.success) {
    throw new Error(formatContractError(result));
  }

  return result.data;
};

/** 根据精确模板版本构建并校验创建请求。 */
export const buildTemplateApplicationRequest = (
  form: TemplateApplicationForm,
  template: ApplicationTemplateSummaryV1,
): CreateTemplateApplicationRequestV1 => {
  const name = form.name.trim();
  const slug = form.slug.trim();
  if (!name) throw new Error("应用名称不能为空");
  if (name.length > 120) throw new Error("应用名称不能超过 120 个字符");
  if (slug && (slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))) {
    throw new Error("slug 只能包含小写字母、数字和单个连字符");
  }

  const templateInput: Record<string, string | boolean> = {};
  for (const field of template.form.fields) {
    if (field.kind === "checkbox") {
      templateInput[field.name] = form.templateInput[field.name] === true;
      continue;
    }

    const rawValue = form.templateInput[field.name];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (field.required && !value) throw new Error(`${field.label}不能为空`);
    if (value) templateInput[field.name] = value;
  }

  const portal = buildApplicationPortalInput(form.portal);
  const result = safeParseCreateTemplateApplicationRequestV1({
    schemaVersion: 1,
    template: template.reference,
    application: {
      name,
      ...(slug ? { slug } : {}),
      ...(portal ? { portal } : {}),
    },
    templateInput,
    credentialDelivery: "direct",
  });

  if (!result.success) throw new Error(formatContractError(result));
  return result.data;
};
