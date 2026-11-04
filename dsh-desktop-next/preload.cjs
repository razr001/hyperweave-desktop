const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hyperweave', Object.freeze({
  session: () => ipcRenderer.invoke('hyperweave:session'),
  login: (credentials) => ipcRenderer.invoke('hyperweave:login', credentials),
  logout: () => ipcRenderer.invoke('hyperweave:logout'),
  request: (input) => ipcRenderer.invoke('hyperweave:request', input),
  submitTask: (input) => ipcRenderer.invoke('hyperweave:submit-task', input),
  upload: (input) => ipcRenderer.invoke('hyperweave:upload', input),
  download: (input) => ipcRenderer.invoke('hyperweave:download', input),
}))
