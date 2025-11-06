/**
 * Gitea OIDC IdP 配置模块
 * 
 * 支持从多种格式的配置文件加载配置：
 * 1. gitea-oidc.config.js (优先级最高)
 * 2. gitea-oidc.config.json (备选)
 * 3. 默认配置 (兜底)
 * 
 * 特性：
 * - 支持环境变量动态配置
 * - 支持函数式配置导出
 * - 自动配置验证
 * - 深度合并配置
 * - 错误处理和回退机制
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Gitea OIDC IdP 完整配置接口
 * 
 * 包含所有可配置的选项，涵盖服务器、日志、OIDC Provider、客户端和用户账户设置
 */
export interface GiteaOidcConfig {
  /**
   * 服务器基础配置
   * - host: 监听地址，'0.0.0.0' 表示监听所有网络接口
   * - port: 服务端口，范围 1-65535
   * - url: 公开访问的完整 URL，用于 OIDC 发现和回调
   */
  server: {
    host: string;
    port: number;
    url: string;
  };
  
  /**
   * 日志系统配置
   * - enabled: 是否启用详细日志输出
   * - level: 日志级别，支持 'info' | 'warn' | 'error' | 'debug'
   */
  logging: {
    enabled: boolean;
    level: 'info' | 'warn' | 'error' | 'debug';
  };
  
  /**
   * OIDC Provider 核心配置
   * 基于 oidc-provider 库的配置选项
   */
  oidc: {
    /**
     * OIDC 发行者 URL
     * 必须与 server.url 保持一致，用于生成发现文档和令牌
     */
    issuer: string;
    
    /**
     * Cookie 签名和加密密钥
     * 建议使用多个密钥以支持密钥轮换
     * 生产环境必须使用强密钥
     */
    cookieKeys: string[];
    
    /**
     * 各种令牌的生存时间（秒）
     * - AccessToken: 访问令牌，用于 API 调用
     * - AuthorizationCode: 授权码，用于授权码流程
     * - IdToken: ID 令牌，包含用户身份信息
     * - RefreshToken: 刷新令牌，用于获取新的访问令牌
     */
    ttl: {
      /**
       * 访问令牌生存时间（秒）
       */
      AccessToken: number;
      /**
       * 授权码生存时间（秒）
       */
      AuthorizationCode: number;
      /**
       * ID 令牌生存时间（秒）
       */
      IdToken: number;
      /**
       * 刷新令牌生存时间（秒）
       */
      RefreshToken: number;
    };
    
    /**
     * OIDC 声明配置
     * 定义支持的标准声明和自定义声明
     * - openid: 核心声明，必须包含 sub（主体标识符）
     * - profile: 用户档案信息，如姓名、邮箱等
     */
    claims: {
      /**
       * 核心声明
       * - 必须包含 sub（主体标识符）
       */
      openid: string[];
      /**
       * 用户档案信息
       * - 如姓名、邮箱等
       */
      profile: string[];
    };
    
    /**
     * OIDC 功能特性开关
     * 控制启用/禁用各种 OIDC 功能
     * - devInteractions: 开发模式交互页面，生产环境应禁用
     * - registration: 客户端动态注册功能
     * - revocation: 令牌撤销功能
     */
    features: {
      /**
       * 开发模式交互页面
       * - 生产环境应禁用
       */
      devInteractions: { enabled: boolean };
      /**
       * 客户端动态注册功能
       */
      registration: { enabled: boolean };
      /**
       * 令牌撤销功能
       */
      revocation: { enabled: boolean };
    };
  };
  
  /**
   * OAuth/OIDC 客户端配置数组
   * 每个客户端代表一个使用此 IdP 的应用程序
   * 
   * 字段说明：
   * - client_id: 客户端唯一标识符
   * - client_secret: 客户端密钥，用于客户端认证
   * - redirect_uris: 授权后重定向的 URL 列表
   * - response_types: 支持的响应类型，如 'code'（授权码流程）
   * - grant_types: 支持的授权类型，如 'authorization_code'
   * - token_endpoint_auth_method: 令牌端点认证方法
   */
  clients: Array<{
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
    response_types: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
  }>;
  
  /**
   * 用户账户配置（硬编码方式）
   * 适用于简单的用户管理场景
   * 
   * 每个用户包含：
   * - accountId: 账户唯一标识符，用作 sub 声明
   * - name: 用户显示名称
   * - email: 用户邮箱地址
   * 
   * 注意：生产环境建议连接数据库进行用户管理
   */
  accounts: Record<string, {
    accountId: string;
    name: string;
    email: string;
  }>;
}

/**
 * 配置模块类型定义
 * 支持两种导出方式：
 * 1. 直接导出配置对象
 * 2. 导出返回配置对象的函数（支持动态配置）
 */
export type ConfigModule = GiteaOidcConfig | (() => GiteaOidcConfig);

/**
 * 默认配置常量
 * 
 * 提供开箱即用的配置，包含：
 * - 本地开发服务器设置
 * - 基础日志配置
 * - 标准 OIDC Provider 设置
 * - Gitea 集成客户端
 * - 测试用户账户
 * 
 * 用户配置文件会深度合并并覆盖这些默认值
 */
const defaultConfig: GiteaOidcConfig = {
  server: {
    host: '0.0.0.0',
    port: 3000,
    url: 'http://localhost:3000',
  },
  
  logging: {
    enabled: true,
    level: 'info',
  },
  
  oidc: {
    issuer: 'http://localhost:3000',
    cookieKeys: ['some-secret-key'],
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 86400,
    },
    claims: {
      openid: ['sub'],
      profile: ['name', 'email'],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
    },
  },
  
  clients: [{
    client_id: 'gitea',
    client_secret: 'secret',
    redirect_uris: ['http://localhost:3001/user/oauth2/gitea/callback'],
    response_types: ['code'],
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'client_secret_basic',
  }],
  
  accounts: {
    'testuser': {
      accountId: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
    },
  },
};

/**
 * 配置加载函数
 * 
 * 按优先级顺序加载配置文件：
 * 1. gitea-oidc.config.js (支持动态配置、环境变量、函数导出)
 * 2. gitea-oidc.config.json (静态配置)
 * 3. 默认配置 (兜底方案)
 * 
 * 特性：
 * - 自动检测配置文件格式
 * - 支持函数式配置导出
 * - 深度合并用户配置和默认配置
 * - 配置验证确保关键选项正确
 * - 错误处理和回退机制
 * 
 * @returns {GiteaOidcConfig} 合并后的完整配置对象
 */
export function loadConfig(): GiteaOidcConfig {
  const jsConfigPath = join(process.cwd(), 'gitea-oidc.config.js');
  const jsonConfigPath = join(process.cwd(), 'gitea-oidc.config.json');
  
  let configPath = '';
  let userConfig: Partial<GiteaOidcConfig> = {};
  
  // 优先查找 .js 配置文件
  if (existsSync(jsConfigPath)) {
    configPath = jsConfigPath;
    try {
      // 动态导入 .js 配置文件
      const configModule = require(jsConfigPath);
      userConfig = typeof configModule === 'function' ? configModule() : configModule;
      console.log(`✅ JS 配置文件已加载: ${configPath}`);
    } catch (error) {
      console.error(`❌ JS 配置文件加载错误: ${error}`);
      console.log('⚠️  使用默认配置继续运行');
      return defaultConfig;
    }
  } else if (existsSync(jsonConfigPath)) {
    configPath = jsonConfigPath;
    try {
      const configFile = readFileSync(jsonConfigPath, 'utf-8');
      userConfig = JSON.parse(configFile);
      console.log(`✅ JSON 配置文件已加载: ${configPath}`);
    } catch (error) {
      console.error(`❌ JSON 配置文件解析错误: ${error}`);
      console.log('⚠️  使用默认配置继续运行');
      return defaultConfig;
    }
  } else {
    console.log(`⚠️  配置文件未找到，查找路径:`);
    console.log(`   - ${jsConfigPath}`);
    console.log(`   - ${jsonConfigPath}`);
    console.log('💡 提示: 创建 gitea-oidc.config.js 或 gitea-oidc.config.json 文件来自定义配置');
    return defaultConfig;
  }
  
  // 深度合并配置（用户配置覆盖默认配置）
  const config = deepMerge(defaultConfig, userConfig);
  
  // 验证配置
  try {
    validateConfig(config);
  } catch (error) {
    console.error(`❌ 配置验证失败: ${error}`);
    console.log('⚠️  使用默认配置继续运行');
    return defaultConfig;
  }
  
  return config;
}

/**
 * 配置验证函数
 * 
 * 验证配置的关键选项，确保：
 * - 服务器端口有效（1-65535）
 * - 必要的 URL 不为空
 * - OIDC 发行者 URL 存在
 * - Cookie 密钥已配置
 * - 至少有一个客户端配置
 * 
 * 验证失败时会抛出错误，触发配置回退到默认值
 * 
 * @param {GiteaOidcConfig} config - 待验证的配置对象
 * @throws {Error} 当配置验证失败时抛出错误
 */
function validateConfig(config: GiteaOidcConfig): void {
  if (!config.server?.port || config.server.port < 1 || config.server.port > 65535) {
    throw new Error('无效的服务器端口号');
  }
  
  if (!config.server?.url) {
    throw new Error('服务器 URL 不能为空');
  }
  
  if (!config.oidc?.issuer) {
    throw new Error('OIDC 发行者 URL 不能为空');
  }
  
  if (!config.oidc?.cookieKeys || config.oidc.cookieKeys.length === 0) {
    throw new Error('Cookie 密钥不能为空');
  }
  
  if (!config.clients || config.clients.length === 0) {
    throw new Error('至少需要配置一个客户端');
  }
}

/**
 * 深度合并对象函数
 * 
 * 将源对象的属性递归合并到目标对象中：
 * - 支持嵌套对象的深度合并
 * - 数组会被完全替换（不进行合并）
 * - undefined 值不会覆盖目标对象的属性
 * - 保持目标对象的类型安全
 * 
 * 用途：将用户配置与默认配置合并，用户配置优先级更高
 * 
 * @template T - 目标对象的类型
 * @param {T} target - 目标对象（通常是默认配置）
 * @param {Partial<T>} source - 源对象（用户配置）
 * @returns {T} 合并后的对象
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(result[key], source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }
  
  return result;
}

/**
 * 导出配置实例
 * 
 * 在模块加载时立即调用 loadConfig() 函数，获取最终的配置对象
 * 这个配置实例会被 server.ts 和其他模块导入使用
 * 
 * 如果配置文件加载或验证失败，将使用默认配置
 */
export const config = loadConfig();
