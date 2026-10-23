import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { getNestOidcAuth, getOptionalNestOidcAuth } from "./requestAuth.js";

export const OidcAuth = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  getNestOidcAuth(context.switchToHttp().getRequest<unknown>()),
);

export const OptionalOidcAuth = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  getOptionalNestOidcAuth(context.switchToHttp().getRequest<unknown>()),
);
