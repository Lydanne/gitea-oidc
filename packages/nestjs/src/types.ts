import type { WebConnectorCoreOptions } from "@gitea-oidc/connector-core";
import type { InjectionToken, ModuleMetadata } from "@nestjs/common";

export type NestOidcModuleOptions = WebConnectorCoreOptions;

export interface NestOidcModuleAsyncOptions {
  readonly imports?: ModuleMetadata["imports"];
  readonly inject?: readonly InjectionToken[];
  readonly useFactory: (
    ...dependencies: any[]
  ) => NestOidcModuleOptions | Promise<NestOidcModuleOptions>;
}
