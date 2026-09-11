import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../index';
import {
  auditActionLabel,
  auditDetailLabel,
  auditResourceLabel,
  prettifyAction,
  systemErrorComponentLabel,
  systemErrorMessage,
  systemErrorMetadataLabel,
} from '../../utils/logLabels';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('audit labels', () => {
  it('translates known action keys and prettifies unknown ones', async () => {
    expect(auditActionLabel(i18n.t, 'server.start')).toBe('Server started');
    expect(auditActionLabel(i18n.t, 'login_success')).toBe('Signed in');
    await i18n.changeLanguage('zh-CN');
    expect(auditActionLabel(i18n.t, 'server.start')).toBe('已启动服务器');
    expect(auditActionLabel(i18n.t, 'login_failed')).toBe('登录失败');
    expect(auditActionLabel(i18n.t, 'theme_settings.update')).toBe('已更新主题设置');
    // Plugin-supplied actions have no catalog entry.
    expect(auditActionLabel(i18n.t, 'acme.widget_toggle')).toBe('Acme Widget Toggle');
  });

  it('builds the dynamic node-assignment actions', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(auditActionLabel(i18n.t, 'node.assign.user')).toBe('已将节点分配给用户');
    expect(auditActionLabel(i18n.t, 'node.assign_wildcard.role')).toBe('已为角色添加通配符节点分配');
  });

  it('translates resource values and passes unknown ones through', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(auditResourceLabel(i18n.t, 'auth')).toBe('身份验证');
    expect(auditResourceLabel(i18n.t, 'server')).toBe('服务器');
    expect(auditResourceLabel(i18n.t, 'third_party')).toBe('third_party');
  });

  it('translates detail field names and passes unknown ones through', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(auditDetailLabel(i18n.t, 'email')).toBe('邮箱');
    expect(auditDetailLabel(i18n.t, 'primaryColor')).toBe('主色');
    expect(auditDetailLabel(i18n.t, 'allocatedMemoryMb')).toBe('分配的内存（MB）');
    expect(auditDetailLabel(i18n.t, 'suspensionReason')).toBe('暂停原因');
    expect(auditDetailLabel(i18n.t, 'unknownField')).toBe('unknownField');
  });

  it('prettifies identifiers for values the panel does not own', () => {
    expect(prettifyAction('server.bulk_delete')).toBe('Server Bulk Delete');
    expect(prettifyAction('login_success')).toBe('Login Success');
  });
});

describe('system error labels', () => {
  it('translates known component names', async () => {
    expect(systemErrorComponentLabel(i18n.t, 'ApiClient')).toBe('API client');
    await i18n.changeLanguage('zh-CN');
    expect(systemErrorComponentLabel(i18n.t, 'ApiClient')).toBe('API 客户端');
    expect(systemErrorComponentLabel(i18n.t, 'WebSocketGateway')).toBe('WebSocket 网关');
    expect(systemErrorComponentLabel(i18n.t, 'AuthStore:refresh')).toBe('认证状态：会话刷新');
    expect(systemErrorComponentLabel(i18n.t, 'LoginPage')).toBe('登录页面');
    expect(systemErrorComponentLabel(i18n.t, 'ServerConfigurationTab')).toBe('服务器配置标签页');
    // Unknown programs keep their own name.
    expect(systemErrorComponentLabel(i18n.t, 'SomePluginThing')).toBe('SomePluginThing');
  });

  it('translates metadata field names', async () => {
    expect(systemErrorMetadataLabel(i18n.t, 'clientId')).toBe('Client ID');
    await i18n.changeLanguage('zh-CN');
    expect(systemErrorMetadataLabel(i18n.t, 'clientId')).toBe('客户端 ID');
    expect(systemErrorMetadataLabel(i18n.t, 'type')).toBe('类型');
    expect(systemErrorMetadataLabel(i18n.t, 'componentStack')).toBe('组件堆栈');
    expect(systemErrorMetadataLabel(i18n.t, 'pluginData')).toBe('pluginData');
  });

  it('labels mutation and agent reports', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(systemErrorComponentLabel(i18n.t, 'Mutation:CreateServerModal')).toBe('变更操作：CreateServerModal');
    expect(systemErrorComponentLabel(i18n.t, 'agent:sftp_server')).toBe('SFTP 服务');
    expect(systemErrorComponentLabel(i18n.t, 'agent:install_server:cmt123')).toBe('服务器安装:cmt123');
  });

  it('translates the messages the panel produces', async () => {
    expect(systemErrorMessage(i18n.t, 'Unauthorized')).toBe('Unauthorized');
    await i18n.changeLanguage('zh-CN');
    expect(systemErrorMessage(i18n.t, 'Unauthorized')).toBe('未授权访问');
    expect(systemErrorMessage(i18n.t, 'Request failed (504)')).toBe('请求失败（504）');
    expect(systemErrorMessage(i18n.t, 'Invalid credentials')).toBe('凭据无效');
    expect(systemErrorMessage(i18n.t, 'Server is suspended')).toBe('服务器已暂停');
    expect(systemErrorMessage(i18n.t, "Cannot read properties of undefined (reading 'map')")).toBe(
      '无法读取 undefined 的属性“map”',
    );
    expect(systemErrorMessage(i18n.t, 'Request timed out after 15000ms: GET /api/servers/logs')).toBe(
      '请求超时（15000ms）：GET /api/servers/logs',
    );
  });

  it('keeps the recorded detail of agent and runtime messages', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(systemErrorMessage(i18n.t, 'Agent cmt123 not connected')).toBe('代理 cmt123 未连接');
    expect(systemErrorMessage(i18n.t, 'Container error: Container not found for server srv-1')).toBe(
      '容器错误：Container not found for server srv-1',
    );
    expect(systemErrorMessage(i18n.t, 'File system error: mount failed with status 32\nsecond line')).toBe(
      '文件系统错误：mount failed with status 32\nsecond line',
    );
    expect(systemErrorMessage(i18n.t, 'SFTP server failed to start: Address in use (os error 98)')).toBe(
      'SFTP 服务启动失败：Address in use (os error 98)',
    );
    expect(
      systemErrorMessage(i18n.t, 'Manifest validation error: [\n  {"path": ["name"]}\n]'),
    ).toBe('插件清单校验错误：[\n  {"path": ["name"]}\n]');
  });

  it('leaves third-party and runtime text untouched', async () => {
    await i18n.changeLanguage('zh-CN');
    const enoent = "ENOENT: no such file or directory, open '../catalyst-plugins/plugin.json'";
    expect(systemErrorMessage(i18n.t, enoent)).toBe(enoent);
    expect(systemErrorMessage(i18n.t, 'boom')).toBe('boom');
  });

  it('keeps the detail in patterns that carry one', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(systemErrorMessage(i18n.t, 'Failed to read/validate plugin manifest: ENOENT: no such file')).toBe(
      '读取或校验插件清单失败：ENOENT: no such file',
    );
  });
});
