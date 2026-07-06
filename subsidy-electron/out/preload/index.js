"use strict";
const electron = require("electron");
const electronAPI = {
  /**
   * 通用 IPC 调用（Promise 风格）
   * @param channel IPC 通道名，格式：domain:action
   * @param data 可选参数
   */
  invoke: (channel, data) => {
    return electron.ipcRenderer.invoke(channel, data);
  },
  /**
   * 打开文件选择对话框
   * @param options 对话框选项
   */
  selectFile: (options) => {
    return electron.ipcRenderer.invoke("dialog:selectFile", options);
  },
  /**
   * 打开保存对话框
   */
  saveFile: (options) => {
    return electron.ipcRenderer.invoke("dialog:saveFile", options);
  },
  /**
   * 获取应用数据目录
   */
  getUserDataPath: () => {
    return electron.ipcRenderer.invoke("app:getUserDataPath");
  },
  /**
   * 获取数据库文件路径
   */
  getDbPath: () => {
    return electron.ipcRenderer.invoke("app:getDbPath");
  },
  /**
   * 复制文件到指定位置（备份用）
   */
  copyFile: (src, dest) => {
    return electron.ipcRenderer.invoke("fs:copyFile", { src, dest });
  },
  /**
   * 监听更新事件
   */
  onUpdateStatus: (callback) => {
    electron.ipcRenderer.on("update:status", (_e, status) => callback(status));
  },
  onUpdateAvailable: (callback) => {
    electron.ipcRenderer.on("update:available", (_e, info) => callback(info));
  },
  onUpdateProgress: (callback) => {
    electron.ipcRenderer.on("update:progress", (_e, progress) => callback(progress));
  },
  onUpdateError: (callback) => {
    electron.ipcRenderer.on("update:error", (_e, error) => callback(error));
  },
  removeUpdateListeners: () => {
    electron.ipcRenderer.removeAllListeners("update:status");
    electron.ipcRenderer.removeAllListeners("update:available");
    electron.ipcRenderer.removeAllListeners("update:progress");
    electron.ipcRenderer.removeAllListeners("update:error");
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
