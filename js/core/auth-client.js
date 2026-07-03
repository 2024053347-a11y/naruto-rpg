// auth-client.js — 前端认证管理
// ES Module — Discord OAuth 客户端状态管理

class AuthClient {
  constructor() {
    /** @type {object|null} 当前用户对象 */
    this._user = null;
    /** @type {boolean} 是否已执行过认证检查 */
    this._checked = false;
    /** @type {Promise|null} 防止并发 checkAuth 请求 */
    this._pending = null;
  }

  /**
   * 检查当前用户是否已登录。
   * 首次调用会发起 /auth/me 请求，后续调用返回缓存结果。
   * @param {boolean} [force=false] - 强制重新请求（忽略缓存）
   * @returns {Promise<object|null>} 用户对象或 null
   */
  async checkAuth(force = false) {
    if (this._checked && !force) return this._user;

    // 防止多个组件同时触发重复请求
    if (this._pending) return this._pending;

    this._pending = (async () => {
      try {
        const res = await fetch('/auth/me', { credentials: 'same-origin' });
        if (res.ok) {
          this._user = await res.json();
        } else {
          this._user = null;
        }
      } catch {
        this._user = null;
      }
      this._checked = true;
      this._pending = null;
      return this._user;
    })();

    return this._pending;
  }

  /**
   * 获取缓存的用户对象（同步）。
   * 必须在 checkAuth() 之后调用才有值。
   * @returns {object|null}
   */
  getUser() {
    return this._user;
  }

  /**
   * 用户是否已通过认证（同步检查缓存）。
   * @returns {boolean}
   */
  isAuthenticated() {
    return this._user !== null;
  }

  /**
   * 登出当前用户并重定向到登录页。
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // 即使请求失败也清理本地状态并跳转
    }
    this._user = null;
    this._checked = false;
    this._pending = null;
    window.location.href = '/login.html';
  }

  /**
   * 生成用户头像 URL。
   * @param {object} [user=this._user] - 用户对象（需包含 id 和可选的 avatar 字段）
   * @param {number} [size=128] - 头像尺寸（像素）
   * @returns {string|null} 头像 URL 或 null
   */
  getAvatarUrl(user = this._user, size = 128) {
    if (!user) return null;

    if (user.avatar) {
      // 支持动态头像（GIF）
      const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
    }

    // Discord 默认头像计算方式（2023+ 规则）
    const defaultIndex = (BigInt(user.id) >> 22n) % 6n;
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  }

  /**
   * 获取用户的显示名称。
   * 优先使用 global_name，否则 username。
   * @param {object} [user=this._user]
   * @returns {string|null}
   */
  getDisplayName(user = this._user) {
    if (!user) return null;
    return user.global_name || user.username || null;
  }

  /**
   * 如果未登录则跳转到登录页。
   * 适用于需要认证保护的页面。
   * @returns {Promise<object>} 已登录的用户对象
   */
  async requireAuth() {
    const user = await this.checkAuth();
    if (!user) {
      window.location.href = '/login.html';
      // 返回一个永远不会 resolve 的 promise，防止后续代码执行
      return new Promise(() => {});
    }
    return user;
  }
}

export const authClient = new AuthClient();
