import type { InjectionToken, ModuleMetadata } from "@nestjs/common";
import type { WebConnectorCoreOptions } from "@x-oidc/connector-core";

export type NestOidcModuleOptions = WebConnectorCoreOptions;

export interface NestOidcModuleAsyncOptions {
  readonly imports?: ModuleMetadata["imports"];
  readonly inject?: readonly InjectionToken[];
  readonly useFactory: (
    ...dependencies: any[]
  ) => NestOidcModuleOptions | Promise<NestOidcModuleOptions>;
}
