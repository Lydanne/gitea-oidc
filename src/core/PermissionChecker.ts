/**
 * 插件权限检查器
 * 
 * 管理和验证插件权限，确保插件只能访问其声明的资源
 */

import { PluginPermission } from '../types/auth';

/**
 * 权限检查器
 */
export class PermissionChecker {
  private pluginPermissions = new Map<string, Set<PluginPermission>>();
  
  /**
   * 注册插件权限
   * 
   * @param pluginName 插件名称
   * @param permissions 权限列表
   */
  registerPlugin(pluginName: string, permissions: PluginPermission[]): void {
    this.pluginPermissions.set(pluginName, new Set(permissions));
  }
  
  /**
   * 检查插件是否拥有指定权限
   * 
   * @param pluginName 插件名称
   * @param permission 权限
   * @returns 是否拥有权限
   */
  hasPermission(pluginName: string, permission: PluginPermission): boolean {
    const permissions = this.pluginPermissions.get(pluginName);
    return permissions?.has(permission) ?? false;
  }
  
  /**
   * 要求插件拥有指定权限，否则抛出错误
   * 
   * @param pluginName 插件名称
   * @param permission 权限
   * @throws {Error} 如果插件没有权限
   */
  requirePermission(pluginName: string, permission: PluginPermission): void {
    if (!this.hasPermission(pluginName, permission)) {
      throw new Error(
        `Plugin "${pluginName}" does not have permission: ${permission}`
      );
    }
  }
  
  /**
   * 检查插件是否拥有所有指定权限
   * 
   * @param pluginName 插件名称
   * @param permissions 权限列表
   * @returns 是否拥有所有权限
   */
  hasAllPermissions(pluginName: string, permissions: PluginPermission[]): boolean {
    return permissions.every(p => this.hasPermission(pluginName, p));
  }
  
  /**
   * 检查插件是否拥有任一指定权限
   * 
   * @param pluginName 插件名称
   * @param permissions 权限列表
   * @returns 是否拥有任一权限
   */
  hasAnyPermission(pluginName: string, permissions: PluginPermission[]): boolean {
    return permissions.some(p => this.hasPermission(pluginName, p));
  }
  
  /**
   * 获取插件的所有权限
   * 
   * @param pluginName 插件名称
   * @returns 权限列表
   */
  getPermissions(pluginName: string): PluginPermission[] {
    const permissions = this.pluginPermissions.get(pluginName);
    return permissions ? Array.from(permissions) : [];
  }
  
  /**
   * 移除插件权限
   * 
   * @param pluginName 插件名称
   */
  unregisterPlugin(pluginName: string): void {
    this.pluginPermissions.delete(pluginName);
  }
  
  /**
   * 获取所有已注册的插件
   * 
   * @returns 插件名称列表
   */
  getRegisteredPlugins(): string[] {
    return Array.from(this.pluginPermissions.keys());
  }
  
  /**
   * 清空所有权限
   */
  clear(): void {
    this.pluginPermissions.clear();
  }
}
