export const MODEL_INSPECTOR_MIN_WIDTH = 440;
export const MODEL_INSPECTOR_MIN_HEIGHT = 520;
export const MODEL_INSPECTOR_DEFAULT_WIDTH = 720;
export const MODEL_INSPECTOR_DEFAULT_HEIGHT = 820;

const containsPoint = (bounds, point) => point.x >= bounds.x
  && point.x < bounds.x + bounds.width
  && point.y >= bounds.y
  && point.y < bounds.y + bounds.height;

const overlapArea = (a, b) => {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
};

export function resolveModelInspectorWindowState({ saved, displays, mainBounds }) {
  const availableDisplays = Array.isArray(displays) && displays.length ? displays : [{ id: 0, workArea: { x: 0, y: 0, width: 1280, height: 800 } }];
  const savedDisplay = typeof saved?.displayId === 'number'
    ? availableDisplays.find((display) => display.id === saved.displayId)
    : undefined;
  const savedBounds = saved?.bounds;
  const matchingDisplay = savedBounds
    ? [...availableDisplays].sort((a, b) => overlapArea(savedBounds, b.workArea) - overlapArea(savedBounds, a.workArea))[0]
    : undefined;
  const mainCenter = mainBounds
    ? { x: mainBounds.x + mainBounds.width / 2, y: mainBounds.y + mainBounds.height / 2 }
    : undefined;
  const mainDisplay = mainCenter
    ? availableDisplays.find((display) => containsPoint(display.workArea, mainCenter))
    : undefined;
  const display = savedDisplay ?? (matchingDisplay && overlapArea(savedBounds, matchingDisplay.workArea) > 0 ? matchingDisplay : undefined) ?? mainDisplay ?? availableDisplays[0];
  const workArea = display.workArea;
  const margin = Math.min(20, Math.max(0, Math.floor(Math.min(workArea.width, workArea.height) / 20)));
  const maxWidth = Math.max(320, workArea.width - margin * 2);
  const maxHeight = Math.max(360, workArea.height - margin * 2);
  const width = Math.min(Math.max(Math.min(MODEL_INSPECTOR_MIN_WIDTH, maxWidth), savedBounds?.width ?? MODEL_INSPECTOR_DEFAULT_WIDTH), maxWidth);
  const height = Math.min(Math.max(Math.min(MODEL_INSPECTOR_MIN_HEIGHT, maxHeight), savedBounds?.height ?? MODEL_INSPECTOR_DEFAULT_HEIGHT), maxHeight);
  const defaultX = workArea.x + workArea.width - width - margin;
  const defaultY = workArea.y + margin;
  const x = Math.min(Math.max(savedBounds?.x ?? defaultX, workArea.x + margin), workArea.x + workArea.width - width - margin);
  const y = Math.min(Math.max(savedBounds?.y ?? defaultY, workArea.y + margin), workArea.y + workArea.height - height - margin);
  return { bounds: { x, y, width, height }, displayId: display.id };
}

export function setModelInspectorAlwaysOnTop(inspectorWindow, value) {
  const nextValue = Boolean(value);
  inspectorWindow.setAlwaysOnTop(nextValue);
  return inspectorWindow.isAlwaysOnTop();
}

export function toggleModelInspectorAlwaysOnTop(inspectorWindow) {
  return setModelInspectorAlwaysOnTop(inspectorWindow, !inspectorWindow.isAlwaysOnTop());
}
