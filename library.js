import { mergeProgress } from './progress.js';

let connection;

function database() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('own-vocatype', 3);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) {
          db.createObjectStore('lessons', { keyPath: 'id' });
          db.createObjectStore('materials');
        }
        if (event.oldVersion < 2) db.createObjectStore('vocabulary', { keyPath: 'id' });
        db.createObjectStore('workspace');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

async function transact(stores, mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const result = run(transaction);
    transaction.oncomplete = () => resolve(result?.());
    transaction.onabort = () => reject(transaction.error);
  });
}

export function listLessons() {
  return transact('lessons', 'readonly', transaction => {
    const request = transaction.objectStore('lessons').getAll();
    return () => request.result.sort((a, b) => b.savedAt - a.savedAt);
  });
}

export function loadWorkspace() {
  return transact('workspace', 'readonly', transaction => {
    const store = transaction.objectStore('workspace');
    const state = store.get('state');
    const materials = store.get('materials');
    const source = store.get('source');
    return () => state.result && materials.result && {
      ...state.result,
      ...materials.result,
      source: source.result === undefined ? materials.result.source : source.result,
      sourceStored: source.result !== undefined,
    };
  });
}

export function saveWorkspace(state, source, materials) {
  return transact('workspace', 'readwrite', transaction => {
    const store = transaction.objectStore('workspace');
    store.put(state, 'state');
    if (source !== undefined) store.put(source, 'source');
    if (materials) store.put(materials, 'materials');
  });
}

export function loadLesson(id) {
  return transact(['lessons', 'materials'], 'readonly', transaction => {
    const lesson = transaction.objectStore('lessons').get(id);
    const materials = transaction.objectStore('materials').get(id);
    return () => lesson.result && materials.result && { ...lesson.result, ...materials.result };
  });
}

export function saveLesson(lesson, materials, progress, pending) {
  return transact(['lessons', 'materials'], 'readwrite', transaction => {
    const store = transaction.objectStore('lessons');
    const request = store.get(lesson.id);
    request.onsuccess = () => {
      const previous = request.result;
      const stats = previous && (previous.progressRevision ?? null) === lesson.progressRevision
        ? mergeProgress(previous.stats, pending) : progress;
      store.put({ ...lesson, stats });
    };
    transaction.objectStore('materials').put(materials, lesson.id);
  });
}

export function savePosition(id, position, revision, pending) {
  return transact('lessons', 'readwrite', transaction => {
    const store = transaction.objectStore('lessons');
    const request = store.get(id);
    request.onsuccess = () => {
      const lesson = request.result;
      if (lesson && (lesson.progressRevision ?? null) === revision) {
        store.put({ ...lesson, position, stats: mergeProgress(lesson.stats, pending) });
      }
    };
  });
}

export function deleteLesson(id) {
  return transact(['lessons', 'materials'], 'readwrite', transaction => {
    transaction.objectStore('lessons').delete(id);
    transaction.objectStore('materials').delete(id);
  });
}

export function listVocabulary() {
  return transact('vocabulary', 'readonly', transaction => {
    const request = transaction.objectStore('vocabulary').getAll();
    return () => request.result.sort((a, b) => a.due - b.due);
  });
}

export function addVocabulary(card) {
  return transact('vocabulary', 'readwrite', transaction => {
    const store = transaction.objectStore('vocabulary');
    const existing = store.get(card.id);
    existing.onsuccess = () => {
      if (!existing.result) store.add(card);
    };
  });
}

export function reviewVocabulary(id, update) {
  return transact('vocabulary', 'readwrite', transaction => {
    const store = transaction.objectStore('vocabulary');
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put(update(request.result));
    };
  });
}

export function deleteVocabulary(id) {
  return transact('vocabulary', 'readwrite', transaction => {
    transaction.objectStore('vocabulary').delete(id);
  });
}

export function exportLibrary() {
  return transact(['lessons', 'materials', 'vocabulary'], 'readonly', transaction => {
    const lessons = transaction.objectStore('lessons').getAll();
    const vocabulary = transaction.objectStore('vocabulary').getAll();
    const materials = new Map();
    const cursor = transaction.objectStore('materials').openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      const { source, original, translation } = entry.value;
      const portable = source.file ? { local: { name: source.file.name, size: source.file.size } } : source;
      materials.set(entry.key, { source: portable, original, translation });
      entry.continue();
    };
    return () => ({
      lessons: lessons.result.filter(lesson => materials.has(lesson.id))
        .map(lesson => ({ ...lesson, ...materials.get(lesson.id) })),
      vocabulary: vocabulary.result,
    });
  });
}

export function importLibrary(backup) {
  return transact(['lessons', 'materials', 'vocabulary'], 'readwrite', transaction => {
    const lessons = transaction.objectStore('lessons');
    const materials = transaction.objectStore('materials');
    const vocabulary = transaction.objectStore('vocabulary');
    const counts = { lessons: 0, cards: 0, skipped: 0 };
    const lessonKeys = lessons.getAllKeys();
    lessonKeys.onsuccess = () => {
      const known = new Set(lessonKeys.result);
      for (const { lesson, materials: content } of backup.lessons) {
        if (known.has(lesson.id)) {
          counts.skipped++;
          continue;
        }
        known.add(lesson.id);
        lessons.add(lesson);
        materials.add(content, lesson.id);
        counts.lessons++;
      }
    };

    const cardKeys = vocabulary.getAllKeys();
    cardKeys.onsuccess = () => {
      const known = new Set(cardKeys.result);
      for (const card of backup.vocabulary) {
        if (known.has(card.id)) {
          counts.skipped++;
          continue;
        }
        known.add(card.id);
        vocabulary.add(card);
        counts.cards++;
      }
    };
    return () => counts;
  });
}

export function reconnectMedia(id, file) {
  return transact('materials', 'readwrite', transaction => {
    const store = transaction.objectStore('materials');
    const existing = store.get(id);
    let connected = false;
    existing.onsuccess = () => {
      const record = existing.result;
      if (!record?.source.local || record.source.local.size !== file.size) return;
      store.put({ ...record, source: { file } }, id);
      connected = true;
    };
    return () => connected;
  });
}
