import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// 家具库和平面图是普通脚本，不在模块图里。不额外通知的话，改这些文件页面不会刷新。
function reloadClassicScripts(){
  return {
    name: 'reload-classic-scripts',
    configureServer(server){
      let pending
      const reload = file => {
        if (!/\.(js|mjs|css)$/.test(file)) return
        if (file.includes('/node_modules/') || file.includes('/dist/')) return
        const mods = server.moduleGraph.getModulesByFile(file)
        if (mods && mods.size) return
        clearTimeout(pending)
        pending = setTimeout(() => server.ws.send({type:'full-reload', path:'*'}), 40)
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
    },
  }
}

function copyClassicScripts(){
  return {
    name: 'copy-classic-scripts',
    apply: 'build',
    writeBundle(options){
      cpSync(resolve('js'), resolve(options.dir || 'dist', 'js'), {recursive:true})
    },
  }
}

export default defineConfig({
  appType: 'mpa',
  publicDir: false,
  server: {port:5184, strictPort:true, host:true},
  plugins: [reloadClassicScripts(), copyClassicScripts()],
})
