import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { NestOidcController } from "./controller.js";
import { NestOidcOptionalAuthGuard, NestOidcRequiredAuthGuard } from "./guards.js";
import { NestOidcService } from "./nestOidcService.js";
import { NEST_OIDC_MODULE_OPTIONS } from "./tokens.js";
import type { NestOidcModuleAsyncOptions, NestOidcModuleOptions } from "./types.js";

const EXPORTED_PROVIDERS = [
  NestOidcService,
  NestOidcOptionalAuthGuard,
  NestOidcRequiredAuthGuard,
] as const;

const createConnectorProviders = (): Provider[] => [
  {
    provide: NestOidcService,
    inject: [NEST_OIDC_MODULE_OPTIONS, HttpAdapterHost],
    useFactory: (options: NestOidcModuleOptions, adapterHost: HttpAdapterHost) =>
      new NestOidcService(options, adapterHost),
  },
  NestOidcOptionalAuthGuard,
  NestOidcRequiredAuthGuard,
];

const createDynamicModule = (optionsProvider: Provider): DynamicModule => ({
  module: NestOidcModule,
  controllers: [NestOidcController],
  providers: [optionsProvider, ...createConnectorProviders()],
  exports: [...EXPORTED_PROVIDERS],
});

@Module({})
export class NestOidcModule {
  static register(options: NestOidcModuleOptions): DynamicModule {
    return createDynamicModule({
      provide: NEST_OIDC_MODULE_OPTIONS,
      useValue: options,
    });
  }

  static registerAsync(options: NestOidcModuleAsyncOptions): DynamicModule {
    return {
      ...createDynamicModule({
        provide: NEST_OIDC_MODULE_OPTIONS,
        inject: [...(options.inject ?? [])],
        useFactory: options.useFactory,
      }),
      imports: options.imports,
    };
  }
}
