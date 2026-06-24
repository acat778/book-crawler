import { Site69shuba } from './site-69shuba.js';
import { SiteAlicesw } from './site-alicesw.js';

/**
 * 站点适配器注册中心
 *
 * 所有支持的站点在此注册。新增站点只需：
 * 1. 创建 src/sites/site-{name}.js 继承 SiteAdapter
 * 2. 在此注册
 */

/** @type {Map<string, import('./SiteAdapter.js').SiteAdapter>} */
const adapters = new Map();

// 注册内置站点
adapters.set('69shuba', new Site69shuba());
adapters.set('alicesw', new SiteAlicesw());

/**
 * 获取站点适配器
 * @param {string} siteId - 站点标识
 * @returns {import('./SiteAdapter.js').SiteAdapter}
 * @throws {Error} 未知站点
 */
export function getAdapter(siteId) {
  if (!siteId) siteId = '69shuba'; // 默认
  const adapter = adapters.get(siteId);
  if (!adapter) {
    throw new Error(`未知站点: ${siteId}，可用站点: ${[...adapters.keys()].join(', ')}`);
  }
  return adapter;
}

/**
 * 列出所有注册的站点
 * @returns {Array<{id: string, displayName: string}>}
 */
export function listSites() {
  return [...adapters.values()].map(a => ({ id: a.id, displayName: a.displayName }));
}
