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
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
