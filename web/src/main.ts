import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.js';
import { usePengaturanStore } from './stores/pengaturan.js';
import './assets/tailwind.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.config.errorHandler = (err, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[Refleksi] Galat komponen Vue:', info, err);
};

app.mount('#app');

// Fire-and-forget: nilai bawaan "Refleksi" sudah tampil dari awal, ini cuma
// menimpanya begitu branding kustom (kalau ada) selesai dimuat dari server.
void usePengaturanStore().muat();
