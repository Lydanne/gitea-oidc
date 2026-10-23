/* 原生 WebAuthn 与同源安全设置页面；不依赖外部脚本。 */
(() => {
  const message = document.getElementById("message");
  const show = (text, error = false) => {
    message.textContent = text;
    message.setAttribute("role", error ? "alert" : "status");
  };
  const request = async (url, body) => {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json", "X-OIDC-Security": "1" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) throw new Error("会话已过期，请返回并重新登录");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作失败，请重试");
    return result;
  };
  const decode = (value) =>
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
      char.charCodeAt(0),
    );
  const encode = (value) =>
    btoa(String.fromCharCode(...new Uint8Array(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  const credentialJSON = (credential) => {
    if (typeof credential.toJSON === "function") return credential.toJSON();
    const response = credential.response;
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: response.attestationObject
        ? {
            clientDataJSON: encode(response.clientDataJSON),
            attestationObject: encode(response.attestationObject),
            transports: response.getTransports?.() ?? [],
          }
        : {
            clientDataJSON: encode(response.clientDataJSON),
            authenticatorData: encode(response.authenticatorData),
            signature: encode(response.signature),
            userHandle: response.userHandle ? encode(response.userHandle) : undefined,
          },
    };
  };
  const webauthn = async (options, register) => {
    if (!window.isSecureContext || !window.PublicKeyCredential)
      throw new Error("当前浏览器不支持 Passkey，请使用 HTTPS 和支持 WebAuthn 的浏览器");
    options.challenge = decode(options.challenge);
    if (options.user) options.user.id = decode(options.user.id);
    for (const item of options.allowCredentials ?? options.excludeCredentials ?? [])
      item.id = decode(item.id);
    const credential = register
      ? await navigator.credentials.create({ publicKey: options })
      : await navigator.credentials.get({ publicKey: options });
    if (!credential) throw new Error("未完成 Passkey 验证");
    return credentialJSON(credential);
  };
  let busy = false;
  const run = async (action) => {
    if (busy) return;
    busy = true;
    show("正在处理…");
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const button of buttons) button.disabled = true;
    try {
      await action();
    } catch (error) {
      show(
        error.name === "NotAllowedError"
          ? "Passkey 操作已取消或超时，请重试"
          : error.message || "操作失败",
        true,
      );
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
    }
  };
  const login = document.getElementById("passkey-login");
  if (login) {
    login.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        const flow = login.dataset.flow;
        const { id, options } = await request("/auth/passkey/options", {
          flow,
        });
        const response = await webauthn(options, false);
        const result = await request("/auth/passkey/verify", { flow, id, response });
        window.location.assign(result.redirectTo);
      });
    });
  }
  const settings = document.getElementById("account-security");
  if (!settings) return;
  const api = `${settings.dataset.base}/api/security`;
  const byId = (id) => document.getElementById(id);
  const proof = () => ({
    password: byId("current-password").value,
    otp: byId("current-otp").value,
  });
  const clearProof = () => {
    byId("current-password").value = "";
    byId("current-otp").value = "";
  };
  let otpId;
  const refresh = async () => {
    const summary = await request(api);
    byId("security-status").textContent = summary.local
      ? `OTP：${summary.otpEnabled ? `已启用（剩余 ${summary.recoveryCodesRemaining} 个恢复码）` : "未启用"} · Passkey：${summary.passkeys.length} 个`
      : "此账号使用外部登录，请在对应身份提供者管理安全设置。";
    byId("security-controls").hidden = !summary.local;
    byId("begin-otp").hidden = summary.otpEnabled;
    byId("disable-otp").hidden = !summary.otpEnabled;
    byId("passkeys").replaceChildren();
    for (const item of summary.passkeys) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.name;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "移除";
      button.setAttribute("aria-label", `移除 ${item.name}`);
      button.addEventListener(
        "click",
        () =>
          void run(async () => {
            await request(`${api}/passkeys/delete`, { ...proof(), id: item.id });
            clearProof();
            await refresh();
            show("Passkey 已移除");
          }),
      );
      row.append(name, button);
      byId("passkeys").append(row);
    }
  };
  byId("change-password").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const fields = new FormData(event.target);
      const result = await request(`${api}/password`, {
        ...proof(),
        newPassword: fields.get("newPassword"),
        confirmPassword: fields.get("confirmPassword"),
      });
      event.target.reset();
      clearProof();
      show("密码已更新，所有会话已退出，请使用新密码重新登录");
      window.location.assign(result.redirectTo);
    });
  });
  byId("begin-otp").addEventListener(
    "click",
    () =>
      void run(async () => {
        const result = await request(`${api}/otp/start`, proof());
        otpId = result.id;
        byId("otp-secret").textContent = result.secret;
        byId("otp-uri").textContent = result.uri;
        byId("otp-setup").hidden = false;
        clearProof();
        show("请在 5 分钟内输入认证器动态码完成绑定");
      }),
  );
  byId("confirm-otp").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const result = await request(`${api}/otp/confirm`, {
        id: otpId,
        token: new FormData(event.target).get("token"),
      });
      byId("otp-secret").textContent = "";
      byId("otp-uri").textContent = "";
      byId("otp-setup").hidden = true;
      byId("recovery-codes").textContent = result.recoveryCodes.join("\n");
      byId("recovery").hidden = false;
      event.target.reset();
      await refresh();
      show("OTP 已启用，请保存恢复码");
    });
  });
  byId("hide-recovery").addEventListener("click", () => {
    byId("recovery-codes").textContent = "";
    byId("recovery").hidden = true;
  });
  byId("disable-otp").addEventListener(
    "click",
    () =>
      void run(async () => {
        await request(`${api}/otp/disable`, proof());
        clearProof();
        await refresh();
        show("OTP 已停用，旧恢复码已作废");
      }),
  );
  byId("register-passkey").addEventListener(
    "click",
    () =>
      void run(async () => {
        const { id, options } = await request(`${api}/passkeys/start`, proof());
        clearProof();
        const response = await webauthn(options, true);
        await request(`${api}/passkeys/finish`, { id, response, name: byId("passkey-name").value });
        byId("passkey-name").value = "";
        await refresh();
        show("Passkey 已绑定");
      }),
  );
  void run(async () => {
    await refresh();
    show("");
  });
})();
