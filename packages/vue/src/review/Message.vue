<script setup lang="ts">
import { ref } from 'vue';
import { useUI } from '../context';
import CardHead from './CardHead.vue';
import CommentInput from './CommentInput.vue';
import MoreMenu from './MoreMenu.vue';
import RichText from './RichText.vue';

const props = defineProps<{
  id: string;
  author: string;
  date?: string;
  text: string;
  imported?: boolean;
  readOnly: boolean;
  testId?: string;
}>();

const { editor } = useUI();
const editing = ref(false);

function save(text: string) {
  editor.editComment(props.id, text);
  editing.value = false;
}
</script>

<template>
  <div class="ml-message" :data-testid="testId">
    <CardHead :name="author" :date="date" :imported="imported">
      <template v-if="!readOnly" #actions><slot name="actions" /><MoreMenu label="Comment options" :test-id="`${testId}-more`" @edit="editing = true" @delete="editor.deleteComment(id)" /></template>
    </CardHead>
    <CommentInput v-if="editing" placeholder="Edit comment" :initial="text" submit-label="Save" auto-focus @submit="save" @cancel="editing = false" />
    <div v-else class="ml-card-text"><RichText :text="text" /></div>
  </div>
</template>
