import { contextBridge, ipcRenderer } from "electron";
const electronAPI = {
  /**
   * 通用 IPC 调用（Promise 风格）
   * @param channel IPC 通道名，格式：domain:action
   * @param data 可选参数
   */
  invoke: (channel, data) => {
    return ipcRenderer.invoke(channel, data);
  },
  /**
   * 打开文件选择对话框
   * @param options 对话框选项
   */
  selectFile: (options) => {
    return ipcRenderer.invoke("dialog:selectFile", options);
  },
  /**
   * 打开保存对话框
   */
  saveFile: (options) => {
    return ipcRenderer.invoke("dialog:saveFile", options);
  },
  /**
   * 获取应用数据目录
   */
  getUserDataPath: () => {
    return ipcRenderer.invoke("app:getUserDataPath");
  },
  /**
   * 获取数据库文件路径
   */
  getDbPath: () => {
    return ipcRenderer.invoke("app:getDbPath");
  },
  /**
   * 复制文件到指定位置（备份用）
   */
  copyFile: (src, dest) => {
    return ipcRenderer.invoke("fs:copyFile", { src, dest });
  }
};
contextBridge.exposeInMainWorld("electronAPI", electronAPI);
