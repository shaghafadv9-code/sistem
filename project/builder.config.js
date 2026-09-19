// Smart Secretary — electron-builder config (platform-aware)
const isWin = process.platform === 'win32';
module.exports = {
  appId: 'com.smartsecretary.app',
  productName: 'Smart Secretary',
  directories: { output: 'release' },
  files: ['electron/**/*', 'server/**/*', 'client/dist/**/*', 'assets/**/*', 'package.json'],
  asarUnpack: ['node_modules/sql.js/dist/*.wasm'],
  win: {
    target: ['nsis'],
    icon: 'assets/icon.ico',
    // تضمين الأيقونة في الـ exe يتطلب wine على غير-Windows — يُضمّن تلقائيًا عند البناء على Windows
    signAndEditExecutable: isWin
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Smart Secretary',
    uninstallDisplayName: 'Smart Secretary',
    artifactName: 'Smart-Secretary-Setup-${version}.exe'
  }
};
