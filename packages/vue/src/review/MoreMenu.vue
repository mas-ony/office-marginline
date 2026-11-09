<script setup lang="ts">
import { EllipsisVertical } from '@lucide/vue';
import { ref } from 'vue';
import Menu from '../controls/Menu.vue';
import MenuItem from '../controls/MenuItem.vue';
import Popover from '../controls/Popover.vue';

defineProps<{ label: string; testId?: string }>();
const emit = defineEmits<{ edit: []; delete: [] }>();
const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
</script>

<template>
  <button ref="btn" type="button" class="ml-icon-btn" :aria-label="label" aria-haspopup="menu" :aria-expanded="open" :data-testid="testId" @click.stop="open = !open">
    <EllipsisVertical :size="16" />
  </button>
  <Popover :anchor="btn" :open="open" align="end" :title="label" @close="open = false">
    <Menu :label="label">
      <MenuItem label="Edit" test-id="comment-edit" @select="open = false; emit('edit')" />
      <MenuItem label="Delete" test-id="comment-delete" @select="open = false; emit('delete')" />
    </Menu>
  </Popover>
</template>
