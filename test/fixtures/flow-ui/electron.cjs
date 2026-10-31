const { app, BrowserWindow, session } = require('electron');
let window;
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== 'about:blank' && !details.url.startsWith('https://flow-fixture.invalid/') }));
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
