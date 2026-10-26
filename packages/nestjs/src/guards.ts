import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { NestOidcService } from "./nestOidcService.js";

const getHttpRequestAndResponse = (context: ExecutionContext): readonly [unknown, unknown] => {
  const http = context.switchToHttp();
  return [http.getRequest<unknown>(), http.getResponse<unknown>()];
};

@Injectable()
export class NestOidcOptionalAuthGuard implements CanActivate {
  @Inject(NestOidcService)
  private readonly oidc!: NestOidcService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const [request, response] = getHttpRequestAndResponse(context);
    await this.oidc.resolveAuth(request, response);
    return true;
  }
}

@Injectable()
export class NestOidcRequiredAuthGuard implements CanActivate {
  @Inject(NestOidcService)
  private readonly oidc!: NestOidcService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const [request, response] = getHttpRequestAndResponse(context);
    await this.oidc.requireAuth(request, response);
    return true;
  }
}
