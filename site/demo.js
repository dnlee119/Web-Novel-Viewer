import { mountViewer } from './viewer/viewer.js';

const viewer = mountViewer(document.getElementById('reader'), { getUrl: './stories/first-train.json' });

viewer.ready.then(() => {
  document.getElementById('fallback').hidden = true;
}, () => {
  // The viewer reports the error and the original remains available.
});
