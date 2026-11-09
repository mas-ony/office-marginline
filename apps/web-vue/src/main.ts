import { createApp } from 'vue';
import '@marginline/vue/style.css';
import '@marginline/web-shared/app.css';
import App from './App.vue';
import { registerServiceWorker } from '@marginline/web-shared/shell';

createApp(App).mount('#root');

if (import.meta.env.PROD) registerServiceWorker();
