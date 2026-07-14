import {
  type CreateCustomApplicationRequestV1,
  safeParseCreateCustomApplicationRequestV1,
} from "@gitea-oidc/contracts";
import type { ApplicationForm } from "../types/admin";

/** 将空格、逗号或换行分隔的表单值规范化为去重列表。 */
export const parseApplicationFormList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,]+/u)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

/** 使用共享 contract 构建并校验后台 API 请求，避免页面复制协议规则。 */
export const buildCustomApplicationRequest = (
  form: ApplicationForm,
): CreateCustomApplicationRequestV1 => {
  const scopes = parseApplicationFormList(form.scopes);
  if (form.refreshToken && !scopes.includes("offline_access")) {
    scopes.push("offline_access");
  }

  const result = safeParseCreateCustomApplicationRequestV1({
    schemaVersion: 1,
    application: {
      name: form.name,
      ...(form.slug.trim() === "" ? {} : { slug: form.slug }),
      environment: form.environment,
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
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    throw new Error(issue ? `${path ? `${path}：` : ""}${issue.message}` : "应用配置无效");
  }

  return result.data;
};
