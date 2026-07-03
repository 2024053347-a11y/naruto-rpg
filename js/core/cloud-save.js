// cloud-save.js — 云存档客户端
// ES Module — 通过 REST API 管理游戏云存档

class CloudSaveClient {
  /**
   * 内部辅助：发送 API 请求并处理错误。
   * @param {string} url
   * @param {RequestInit} [options]
   * @param {string} failMsg - 失败时的默认错误提示
   * @returns {Promise<any>}
   */
  async _request(url, options = {}, failMsg = '请求失败') {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
    });

    if (!res.ok) {
      // 尝试解析服务器返回的错误信息
      const body = await res.json().catch(() => ({}));

      // 认证过期 → 跳转登录
      if (res.status === 401) {
        window.location.href = '/login.html';
        return new Promise(() => {});
      }

      throw new Error(body.error || failMsg);
    }

    // 204 No Content 等无 body 的响应
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    return null;
  }

  /**
   * 获取当前用户的所有云存档列表。
   * @returns {Promise<Array>} 存档列表
   */
  async listSaves() {
    return this._request('/api/saves', {}, '获取存档列表失败');
  }

  /**
   * 上传新的云存档。
   * @param {string} slotName - 存档槽名称（如 "存档 1"）
   * @param {object} saveData - 完整的游戏存档数据
   * @param {object} [previewData] - 存档预览信息（角色名、等级、章节等）
   * @returns {Promise<object>} 创建的存档记录
   */
  async uploadSave(slotName, saveData, previewData = null) {
    return this._request('/api/saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot_name: slotName,
        save_data: saveData,
        preview_data: previewData,
      }),
    }, '上传存档失败');
  }

  /**
   * 下载指定存档的完整数据。
   * @param {string} saveId - 存档 ID
   * @returns {Promise<object>} 存档数据
   */
  async downloadSave(saveId) {
    return this._request(`/api/saves/${saveId}`, {}, '下载存档失败');
  }

  /**
   * 更新已有存档。
   * @param {string} saveId - 存档 ID
   * @param {string} slotName - 存档槽名称
   * @param {object} saveData - 新的游戏存档数据
   * @param {object} [previewData] - 新的预览信息
   * @returns {Promise<object>} 更新后的存档记录
   */
  async updateSave(saveId, slotName, saveData, previewData = null) {
    return this._request(`/api/saves/${saveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot_name: slotName,
        save_data: saveData,
        preview_data: previewData,
      }),
    }, '更新存档失败');
  }

  /**
   * 删除指定存档。
   * @param {string} saveId - 存档 ID
   * @returns {Promise<object|null>}
   */
  async deleteSave(saveId) {
    return this._request(`/api/saves/${saveId}`, {
      method: 'DELETE',
    }, '删除存档失败');
  }

  /**
   * 快速保存：自动覆盖同名存档槽，不存在则创建。
   * 简化游戏内的「保存」流程。
   * @param {string} slotName - 存档槽名称
   * @param {object} saveData - 游戏存档数据
   * @param {object} [previewData] - 预览信息
   * @returns {Promise<object>} 保存结果
   */
  async quickSave(slotName, saveData, previewData = null) {
    const saves = await this.listSaves();
    const existing = saves.find(s => s.slot_name === slotName);

    if (existing) {
      return this.updateSave(existing.id, slotName, saveData, previewData);
    }
    return this.uploadSave(slotName, saveData, previewData);
  }
}

export const cloudSave = new CloudSaveClient();
