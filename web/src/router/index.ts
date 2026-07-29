import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'beranda', component: () => import('../halaman/Beranda.vue') },
    { path: '/masuk', name: 'masuk', component: () => import('../halaman/Masuk.vue') },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../halaman/Dashboard.vue'),
      meta: { butuhLogin: true },
    },
    {
      path: '/profil',
      name: 'profil',
      component: () => import('../halaman/Profil.vue'),
      meta: { butuhLogin: true },
    },
    {
      path: '/admin/guru',
      name: 'admin-guru',
      component: () => import('../halaman/AdminGuru.vue'),
      meta: { butuhLogin: true, butuhAdmin: true },
    },
    {
      path: '/presentasi/:id/edit',
      name: 'editor-presentasi',
      component: () => import('../halaman/EditorPresentasi.vue'),
      meta: { butuhLogin: true },
    },
    {
      path: '/presentasi/:id/riwayat',
      name: 'riwayat-presentasi',
      component: () => import('../halaman/RiwayatPresentasi.vue'),
      meta: { butuhLogin: true },
    },
    {
      path: '/presentasi/:id/mulai',
      name: 'mulai-sesi',
      component: () => import('../halaman/MulaiSesi.vue'),
      meta: { butuhLogin: true },
    },
    { path: '/gabung/:kode', name: 'gabung', component: () => import('../halaman/Gabung.vue') },
    {
      path: '/sesi/:kode/presenter',
      name: 'presenter-sesi',
      component: () => import('../halaman/PresenterSesi.vue'),
      meta: { butuhLogin: true },
    },
    {
      path: '/sesi/:kode/kontrol',
      name: 'kontrol-sesi',
      component: () => import('../halaman/KontrolSesi.vue'),
      meta: { butuhLogin: true },
    },
    {
      path: '/sesi/:id/hasil',
      name: 'hasil-sesi',
      component: () => import('../halaman/HasilSesi.vue'),
      meta: { butuhLogin: true },
    },
    { path: '/p/:kode', name: 'papan', component: () => import('../halaman/Papan.vue') },
    {
      path: '/papan/:id/atur',
      name: 'atur-papan',
      component: () => import('../halaman/AturPapan.vue'),
      meta: { butuhLogin: true },
    },
  ],
});

/**
 * Guard auth. `sudahDicek` membedakan "belum pernah dicek" dari "sudah dicek,
 * memang belum login" — tanpa pembeda ini, setiap navigasi antar rute guru akan
 * memanggil ulang `/api/auth/saya`, padahal cukup sekali per pemuatan halaman.
 */
router.beforeEach(async (ke) => {
  const auth = useAuthStore();

  if (!auth.sudahDicek) {
    await auth.cekSesi();
  }

  if (ke.meta.butuhLogin && !auth.sudahLogin) {
    return { name: 'masuk', query: { lanjut: ke.fullPath } };
  }
  if (ke.meta.butuhAdmin && auth.guru?.role !== 'admin') {
    return { name: 'dashboard' };
  }
  return true;
});
