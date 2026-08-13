import type { InventoryMap } from "./pattern";

export type StoredSource = {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type StudioProject = {
  version: 1;
  id: string;
  name: string;
  savedAt: string;
  source: StoredSource | null;
  settings: {
    boardSize: 52 | 104;
    targetWidth: number;
    ratioWidth: number;
    ratioHeight: number;
    maxColors: number;
    cleanupStrength: number;
    fitMode: "cover" | "contain";
    zoom: number;
    panX: number;
    panY: number;
    brightness: number;
    contrast: number;
    saturation: number;
    sharpness: number;
    removeBackground: boolean;
    backgroundTolerance: number;
    dither: boolean;
    restrictToInventory: boolean;
    showGrid: boolean;
    showBeadCodes: boolean;
  };
  pattern: {
    width: number;
    height: number;
    codes: string[];
    completed: boolean[];
  } | null;
  inventory: InventoryMap;
};

const DATABASE_NAME = "pindou-studio";
const STORE_NAME = "projects";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地项目库"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地项目操作失败"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("本地项目操作失败"));
    };
  });
}

export function saveLocalProject(project: StudioProject) {
  return withStore("readwrite", (store) => store.put(project));
}

export async function listLocalProjects() {
  const projects = await withStore<StudioProject[]>("readonly", (store) => store.getAll());
  return projects.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export function loadLocalProject(id: string) {
  return withStore<StudioProject | undefined>("readonly", (store) => store.get(id));
}

export function deleteLocalProject(id: string) {
  return withStore("readwrite", (store) => store.delete(id));
}

export function parseProjectFile(text: string): StudioProject {
  const value = JSON.parse(text) as Partial<StudioProject>;
  if (
    value.version !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !value.settings ||
    (value.pattern && (!Array.isArray(value.pattern.codes) || !Array.isArray(value.pattern.completed)))
  ) {
    throw new Error("不是有效的拼豆稿项目文件");
  }
  return value as StudioProject;
}

export function projectFileBlob(project: StudioProject) {
  return new Blob([JSON.stringify(project)], { type: "application/json;charset=utf-8" });
}
