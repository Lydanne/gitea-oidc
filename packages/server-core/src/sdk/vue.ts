/**
 * Vue 接入组件和组合式函数
 */

import { defineComponent, h, ref } from "vue";
import type { ProviderApiRequest } from "../types/providerApi.js";
import { GiteaOidcClient, type GiteaOidcClientOptions } from "./client.js";

/**
 * 创建 Provider API 调用组合式函数
 * @param options SDK 客户端配置
 */
export function useProviderRequest(options: GiteaOidcClientOptions) {
  const client = new GiteaOidcClient(options);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const request = async <T = unknown>(provider: string, payload: ProviderApiRequest) => {
    loading.value = true;
    error.value = null;
    try {
      return await client.providerRequest<T>(provider, payload);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  return {
    client,
    error,
    loading,
    request,
  };
}

/**
 * OIDC 登录按钮组件
 */
export const GiteaOidcLoginButton = defineComponent({
  name: "GiteaOidcLoginButton",
  props: {
    href: { type: String, required: true },
    label: { type: String, default: "登录" },
  },
  setup(props) {
    return () =>
      h(
        "a",
        {
          href: props.href,
          style:
            "display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 12px;border-radius:6px;background:#176b87;color:#fff;text-decoration:none;font-weight:600;",
        },
        props.label,
      );
  },
});

/**
 * 用户菜单组件
 */
export const GiteaOidcUserMenu = defineComponent({
  name: "GiteaOidcUserMenu",
  props: {
    user: { type: Object, required: true },
    logoutHref: { type: String, default: "" },
  },
  setup(props) {
    return () =>
      h("div", { style: "display:flex;align-items:center;gap:10px;" }, [
        h("span", {}, (props.user as any).name ?? (props.user as any).username ?? "用户"),
        props.logoutHref
          ? h("a", { href: props.logoutHref, style: "color:#176b87;" }, "退出")
          : null,
      ]);
  },
});
