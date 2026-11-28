const clamp = (value, max = 1) => Math.min(max, Math.max(0, value));

function rangesFor(groups, length) {
  let end = 0;
  return groups.map((group) => {
    const start = end;
    end += length(group);
    return { group, start, end };
  });
}

export function groupRanges(groups, viewportHeight) {
  return rangesFor(groups, (group) => Math.max(1, Math.round(group.scrollVh * viewportHeight / 100)));
}

export function timeRanges(groups) {
  return rangesFor(groups, (group) => group.autoMs ?? 6000);
}

export function positionAt(ranges, offset) {
  const limit = ranges.at(-1).end;
  const scroll = clamp(offset, limit);
  let lower = 0;
  let upper = ranges.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (scroll < ranges[middle].end) upper = middle;
    else lower = middle + 1;
  }
  const { group, start, end } = ranges[lower];
  return { group, progress: (scroll - start) / (end - start) };
}

export function offsetAt(ranges, groupId, progress) {
  const index = ranges.findIndex(({ group }) => group.id === groupId);
  if (index === -1 || !Number.isFinite(progress)) return null;
  const { start, end } = ranges[index];
  // The next group owns the exact internal boundary.
  const lastPixel = index < ranges.length - 1 ? end - 1 : end;
  return Math.min(lastPixel, start + (end - start) * clamp(progress));
}

export function objectState(object, progress, width, motion = true) {
  const visible = width >= object.minWidth && width <= object.maxWidth &&
    progress >= object.showFrom && (progress < object.showTo || progress === 1 && object.showTo === 1);
  if (!visible || !motion) return { visible, opacity: 1, translate: 0 };

  const relative = (progress - object.showFrom) / (object.showTo - object.showFrom);
  let effect = object.hold;
  let intensity = 0;
  let direction = 1;
  if (relative < object.enterEnd) {
    effect = object.enter;
    intensity = 1 - relative / object.enterEnd;
  } else if (relative >= object.exitStart && object.exitStart < 1) {
    effect = object.exit;
    intensity = (relative - object.exitStart) / (1 - object.exitStart);
    direction = -1;
  } else if (object.exitStart > object.enterEnd) {
    const holdProgress = (relative - object.enterEnd) / (object.exitStart - object.enterEnd);
    intensity = Math.sin(Math.PI * clamp(holdProgress)) * 0.2;
  }
  return {
    visible,
    opacity: effect === 'fade' ? 1 - intensity : 1,
    translate: effect === 'slide' ? 24 * intensity * direction : 0,
  };
}
