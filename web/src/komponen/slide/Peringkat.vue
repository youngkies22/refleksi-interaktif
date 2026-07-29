<script setup lang="ts">
import type { AgregatPosisi, JawabanPayload, Opsi, Slide } from '@bersama/tipe';
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';

const props = defineProps<{
  slide: Slide;
  agregat: AgregatPosisi | null;
  mode: 'peserta' | 'presenter';
  terkunci: boolean;
  sudahJawab: boolean;
}>();
const emit = defineEmits<{ jawab: [payload: JawabanPayload] }>();

const urutanLokal = ref<Opsi[]>([]);
watch(() => props.slide.id, () => (urutanLokal.value = [...props.slide.opsi]), { immediate: true });

const terurut = computed(() => {
  if (!props.agregat) return [];
  const posisi = new Map(props.agregat.data.map((d) => [d.opsiId, d.rataPosisi]));
  return [...props.slide.opsi].sort((a, b) => (posisi.get(a.id) ?? 999) - (posisi.get(b.id) ?? 999));
});

function kirim(): void {
  emit('jawab', { tipe: 'peringkat', urutan: urutanLokal.value.map((o) => o.id) });
}
</script>

<template>
  <div class="space-y-4">
    <template v-if="mode === 'peserta' && !sudahJawab && !terkunci">
      <p class="text-xs text-slate-400 text-center">Seret untuk mengurutkan, dari yang paling kamu setujui</p>
      <draggable v-model="urutanLokal" item-key="id" handle=".pegangan" class="space-y-2">
        <template #item="{ element: o, index: i }">
          <div class="flex items-center gap-2 rounded-xl border border-slate-300 pr-4 pl-1 py-1 bg-white">
            <span class="pegangan cursor-grab active:cursor-grabbing text-slate-300 select-none touch-none flex items-center justify-center w-11 h-11 text-lg shrink-0">⠿</span>
            <span class="w-5 text-sm text-slate-400 shrink-0">{{ i + 1 }}</span>
            <span class="flex-1 py-2">{{ o.teks }}</span>
          </div>
        </template>
      </draggable>
      <button type="button" class="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 hover:bg-blue-700" @click="kirim">
        Kirim Urutan
      </button>
    </template>
    <p v-else-if="mode === 'peserta'" class="text-center text-slate-400">Jawaban terkirim. Menunggu peserta lain...</p>

    <div v-if="mode === 'presenter' && !terkunci" class="text-center py-10">
      <p class="text-slate-400">⏳ Menunggu dikunci untuk menampilkan hasil...</p>
      <p class="text-sm text-slate-400 mt-2">{{ agregat?.total ?? 0 }} jawaban masuk</p>
    </div>
    <div v-else-if="agregat && (mode === 'presenter' || sudahJawab)" class="space-y-2 pt-2">
      <div
        v-for="(o, i) in terurut"
        :key="o.id"
        class="flex items-center gap-3 rounded-xl border border-slate-200 py-3 px-4"
      >
        <span class="w-6 text-sm font-bold text-blue-600">#{{ i + 1 }}</span>
        <span class="flex-1">{{ o.teks }}</span>
      </div>
      <p class="text-xs text-slate-400 text-right">{{ agregat.total }} jawaban</p>
    </div>
  </div>
</template>
