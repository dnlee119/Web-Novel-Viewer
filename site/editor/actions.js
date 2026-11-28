import { iconButton } from '../ui/icon.js';

const undo = 'M9 4 4 9l5 5M5 9h8a6 6 0 0 1 0 12';
const copy = 'M8 8h12v13H8zM5 16H3V3h12v2';
const paste = 'M8 5H5v16h14V5h-3M9 3h6v4H9z';
const trash = 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7';
const up = 'm5 14 7-7 7 7';
const down = 'm5 10 7 7 7-7';
const close = 'm6 6 12 12M18 6 6 18';
const eye = 'M2 12q10-15 20 0-10 15-20 0ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0';
const image = 'M3 4h18v16H3zM4 17l5-5 4 3 3-5 5 7M7 8h1';
const link = 'm9 15 6-6m-4-2 2-2a5 5 0 0 1 7 7l-3 3m-4 2-2 2a5 5 0 0 1-7-7l3-3';
const actions = {
  undo: ['실행 취소','Undo',undo], redo: ['다시 실행','Redo','m15 4 5 5-5 5m4-5h-8a6 6 0 0 0 0 12'],
  openFile: ['파일 열기','Open file','M2 18V5h8l2 3h9v2M3 19l3-8h16l-3 8z'],
  exportJson: ['JSON 사본 내보내기','Export JSON','M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'],
  showJson: ['JSON 텍스트 보기','View JSON','m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 18'],
  save: ['서버에 저장','Save to server','M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5'],
  load: ['호스트에서 불러오기','Reload from server','M4 9a8 8 0 1 1 0 7M4 3v6h6'],
  draft: ['임시 저장','Save draft','M3 3h15l3 3v15H3zM7 3v6h9V3M7 21v-8h10v8'],
  restore: ['임시본 복구','Restore draft','M4 10a8 8 0 1 1 0 6M3 4v6h6m3-3v6l4 2'],
  preview: ['미리보기 열기','Open preview',eye], closePreview: ['미리보기 닫기','Close preview',eye+'M3 3l18 18'],
  addScene: ['장면 추가','Add scene','M3 4h14v8M3 4v14h8m6-6v10m-5-5h10'],
  deleteScene: ['해당 장면 삭제','Delete scene',trash], pasteScene: ['장면 붙여넣기','Paste scene',paste],
  sceneUp: ['장면 위로','Move scene up',up], sceneDown: ['장면 아래로','Move scene down',down],
  addText: ['문단 추가','Insert paragraph','M14 21V3H9a5 5 0 0 0 0 10h1M10 21V3m4 0h4'],
  addImage: ['이미지 삽입','Insert image',image], addMedia: ['미디어 삽입','Insert media','M3 4h18v16H3zM10 8l6 4-6 4z'],
  bold: ['굵게','Bold','M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z'],
  italic: ['기울임','Italic','M11 4h9M4 20h9M16 4 8 20'], underline: ['밑줄','Underline','M6 3v8a6 6 0 0 0 12 0V3M4 21h16'],
  link: ['링크 삽입','Insert link',link], feature: ['연출 객체 만들기','Create effect object','m3 21 13-13 3 3L6 24zM6 2v6M3 5h6m10-3v5m-2.5-2.5h5'],
  dissolve: ['연출 해제','Remove effect','M3 3l18 18M4 20l8-8m4-4 2-2 3 3-2 2'],
  copy: ['객체 복사','Copy objects',copy], paste: ['객체 붙여넣기','Paste objects',paste],
  move: ['선택한 객체 이동','Move selected objects','M3 5h8v14H3zM9 12h12m-5-5 5 5-5 5'],
  closeInspector: ['속성 닫기','Close properties',close], objectUp: ['객체 위로','Move object up',up],
  objectDown: ['객체 아래로','Move object down',down], deleteObject: ['객체 삭제','Delete object',trash],
  cancel: ['취소','Cancel',close], close: ['닫기','Close',close],
  selectScene: ['장면 선택','Select scene'], copyScene: ['장면 복사','Copy scene'],
  confirmImage: ['이미지 추가','Add image'], confirmMedia: ['미디어 추가','Add media'], applyLink: ['링크 적용','Apply link'],
};
const byLabel = new Map(Object.entries(actions).map(([id, [ko]]) => [ko, id]));

export function editorActions(locale, messages = {}) {
  const korean = locale.toLowerCase().split('-')[0] === 'ko';
  function label(source) {
    const id = byLabel.get(source);
    return id ? messages[id] || actions[id][korean ? 0 : 1] : source;
  }
  return { label, apply(button, source) {
    const command = actions[byLabel.get(source)];
    if (command) button.lang = locale;
    const path = command?.[2];
    if (path) iconButton(button, path, label(source));
    else button.textContent = label(source);
  } };
}
