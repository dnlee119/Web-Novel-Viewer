import { assetUrl } from '../viewer/model.js';
import { parseWork, readWork } from '../viewer/source.js';

export async function loadEditorWork(options, document, signal) {
  if (options.load) {
    const source = await options.load({ signal });
    const baseUrl = new URL(options.assetBaseUrl ?? options.getUrl ?? document.baseURI, document.baseURI).href;
    return { work: parseWork(source, { document, baseUrl }), baseUrl };
  }
  return readWork(options.getUrl ? { getUrl: options.getUrl } : options.source, {
    document, signal, assetBaseUrl: options.assetBaseUrl,
  });
}

export async function saveEditorWork(options, document, work, signal) {
  if (options.save) {
    const result = await options.save(work, { signal });
    if (result === true || result?.ok === true) return;
    throw new Error('호스트가 저장을 확인하지 않았습니다.');
  }
  const url = assetUrl(options.postUrl, document.baseURI, 'postUrl');
  const response = await document.defaultView.fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(work), signal,
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
}

export function portableWork(work, baseUrl) {
  const portable = structuredClone(work);
  function rebase(parts) {
    for (const part of parts) {
      if (part.tag === 'a') part.href = assetUrl(part.href, baseUrl, 'link');
      if (part.children) rebase(part.children);
    }
  }
  for (const group of portable.groups) {
    for (const object of group.objects) {
      if (object.src) object.src = assetUrl(object.src, baseUrl, 'src');
      if (object.content) rebase(object.content);
    }
  }
  return portable;
}
