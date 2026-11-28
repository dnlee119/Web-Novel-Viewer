import { mountEditor } from './editor/editor.js';

mountEditor(document.getElementById('work-editor'), {
  source: { getUrl: './stories/first-train.json' },
  draftKey: 'first-train-demo',
});
