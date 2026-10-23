import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { PRODUCT_NAME } from '../shared/product'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: PRODUCT_NAME,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
