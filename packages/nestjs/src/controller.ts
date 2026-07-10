import { OIDC_CALLBACK_PATH, OIDC_LOGIN_PATH, OIDC_LOGOUT_PATH } from "@gitea-oidc/connector-core";
import { All, Bind, Controller, Inject, Req, Res } from "@nestjs/common";
import { NestOidcService } from "./nestOidcService.js";

@Controller()
export class NestOidcController {
  @Inject(NestOidcService)
  private readonly oidc!: NestOidcService;

  @All(OIDC_LOGIN_PATH)
  @Bind(Req(), Res())
  async login(request: unknown, response: unknown): Promise<void> {
    await this.oidc.handleLogin(request, response);
  }

  @All(OIDC_CALLBACK_PATH)
  @Bind(Req(), Res())
  async callback(request: unknown, response: unknown): Promise<void> {
    await this.oidc.handleCallback(request, response);
  }

  @All(OIDC_LOGOUT_PATH)
  @Bind(Req(), Res())
  async logout(request: unknown, response: unknown): Promise<void> {
    await this.oidc.handleLogout(request, response);
  }
}
