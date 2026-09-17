import { create } from 'zustand';

let toastId = 1;
export const useStore = create((set, get) => ({
  user: null, perms: {}, company: {},
  setAuth: (user, perms) => set({ user, perms }),
  can: (module, action = 'view') => !!get().perms[`${module}:${action}`],
  setCompany: (company) => set({ company }),

  theme: localStorage.getItem('ss_theme') || 'light',
  toggleTheme: () => {
    const t = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('ss_theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
    set({ theme: t });
  },

  toasts: [],
  toast: (msg, type = 'success') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, msg, type }] });
    setTimeout(() => set({ toasts: get().toasts.filter(t => t.id !== id) }), 3800);
  },

  palette: false, setPalette: (v) => set({ palette: v }),
  assistant: false, setAssistant: (v) => set({ assistant: v }),
  project: '', setProject: (v) => set({ project: v }),
  sidebar: true, setSidebar: (v) => set({ sidebar: v ?? !get().sidebar }),
  online: navigator.onLine, setOnline: (v) => set({ online: v }),
  notifTick: 0, bumpNotif: () => set({ notifTick: get().notifTick + 1 }),
  maintenance: false, maintenanceMsg: '',
  setMaintenance: (maintenance, maintenanceMsg = '') => set({ maintenance, maintenanceMsg }),
}));
