import { describe, it, expect, beforeEach } from 'vitest';

import { PermissionChecker } from '../PermissionChecker';
import { PluginPermission } from '../../types/auth';

describe('PermissionChecker', () => {
  let checker: PermissionChecker;

  beforeEach(() => {
    checker = new PermissionChecker();
  });

  it('registerPlugin 应该存储权限信息', () => {
    checker.registerPlugin('local', [PluginPermission.READ_USER, PluginPermission.CREATE_USER]);

    expect(checker.getPermissions('local')).toEqual([
      PluginPermission.READ_USER,
      PluginPermission.CREATE_USER,
    ]);
  });

  it('hasPermission 和 requirePermission 应该按权限返回结果', () => {
    checker.registerPlugin('local', [PluginPermission.READ_USER]);

    expect(checker.hasPermission('local', PluginPermission.READ_USER)).toBe(true);
    expect(checker.hasPermission('local', PluginPermission.CREATE_USER)).toBe(false);

    expect(() => checker.requirePermission('local', PluginPermission.READ_USER)).not.toThrow();
    expect(() => checker.requirePermission('local', PluginPermission.CREATE_USER)).toThrow(
      /does not have permission/i,
    );
  });

  it('hasAllPermissions 与 hasAnyPermission 应该返回正确布尔值', () => {
    checker.registerPlugin('local', [PluginPermission.READ_USER, PluginPermission.CREATE_USER]);

    expect(
      checker.hasAllPermissions('local', [PluginPermission.READ_USER, PluginPermission.CREATE_USER]),
    ).toBe(true);
    expect(checker.hasAllPermissions('local', [PluginPermission.READ_USER, PluginPermission.DELETE_USER])).toBe(
      false,
    );

    expect(checker.hasAnyPermission('local', [PluginPermission.DELETE_USER, PluginPermission.CREATE_USER])).toBe(
      true,
    );
    expect(checker.hasAnyPermission('local', [PluginPermission.DELETE_USER])).toBe(false);
  });

  it('unregisterPlugin 与 clear 应该移除记录', () => {
    checker.registerPlugin('local', [PluginPermission.READ_USER]);
    checker.registerPlugin('feishu', [PluginPermission.CREATE_USER]);

    checker.unregisterPlugin('local');
    expect(checker.getPermissions('local')).toEqual([]);

    checker.clear();
    expect(checker.getPermissions('feishu')).toEqual([]);
    expect(checker.getRegisteredPlugins()).toEqual([]);
  });
});
