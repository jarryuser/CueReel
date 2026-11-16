import { addVocabulary, deleteVocabulary, listVocabulary, reviewVocabulary } from './library.js?v=4';

const intervals = [1, 3, 7, 14, 30];
const day = 24 * 60 * 60 * 1000;

export function scheduleReview(card, remembered, now = Date.now()) {
  if (!remembered) return { ...card, stage: 0, due: now + 10 * 60 * 1000 };

  const stage = Math.min(card.stage, intervals.length - 1);
  return { ...card, stage: Math.min(stage + 1, intervals.length - 1), due: now + intervals[stage] * day };
}

export function connectVocabulary(readContext, openContext) {
  const panel = document.querySelector('#vocabulary');
  const total = document.querySelector('#vocabulary-count');
  const list = document.querySelector('#saved-vocabulary');
  const message = document.querySelector('#vocabulary-status');
  const start = document.querySelector('#start-review');
  const review = document.querySelector('#review-card');
  const front = document.querySelector('#review-front');
  const reveal = document.querySelector('#reveal-card');
  const back = document.querySelector('#review-back');
  const meaning = document.querySelector('#review-meaning');
  const context = document.querySelector('#review-context');
  const sourceButton = document.querySelector('#review-source');
  const dialog = document.querySelector('#vocabulary-editor');
  const form = document.querySelector('#save-vocabulary');
  const formStatus = document.querySelector('#vocabulary-editor-status');
  const term = form.elements.namedItem('term');
  const definition = form.elements.namedItem('meaning');
  let draft;
  let activeCard;
  let updating = false;

  async function refresh() {
    const cards = await listVocabulary();
    const due = cards.filter(card => card.due <= Date.now());
    total.textContent = `Cards: ${cards.length} · Due: ${due.length}`;
    const items = document.createDocumentFragment();
    for (const card of cards) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.dir = 'auto';
      name.textContent = card.term;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete the card “${card.term}”`);
      remove.addEventListener('click', () => void perform(async () => {
        await deleteVocabulary(card.id);
        if (activeCard?.id === card.id) {
          activeCard = undefined;
          review.hidden = true;
        }
        await refresh();
      }));
      item.append(name, remove);
      items.append(item);
    }
    list.replaceChildren(items);
    return due;
  }

  async function showNext() {
    const due = await refresh();
    activeCard = due[0];
    review.hidden = !activeCard;
    reveal.hidden = false;
    back.hidden = true;
    if (!activeCard) {
      message.textContent = 'No cards are due for review';
      return;
    }
    front.textContent = activeCard.term;
    meaning.textContent = activeCard.meaning;
    context.textContent = [activeCard.context, activeCard.source].filter(Boolean).join(' · ');
    sourceButton.hidden = !activeCard.lessonId;
    reveal.focus();
  }

  async function perform(action, feedback = message) {
    if (updating) return;
    updating = true;
    feedback.textContent = '';
    try {
      await action();
    } catch {
      feedback.textContent = 'Could not update vocabulary. Try again.';
    } finally {
      updating = false;
    }
  }

  document.querySelector('#add-vocabulary').addEventListener('click', () => {
    draft = readContext();
    if (!draft) return;

    term.value = draft.context;
    definition.value = draft.translation;
    document.querySelector('#vocabulary-context').textContent = draft.context;
    formStatus.textContent = '';
    dialog.showModal();
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = term.value.trim();
    const value = definition.value.trim();
    if (!draft || !name || !value) return;
    const id = JSON.stringify([name.normalize('NFC'), value.normalize('NFC'), draft.context]);
    const card = { id, term: name, meaning: value, context: draft.context, source: draft.source,
      lessonId: draft.lessonId, time: draft.time, stage: 0, due: Date.now() };

    void perform(async () => {
      await addVocabulary(card);
      await refresh();
      dialog.close();
      panel.open = true;
      message.textContent = 'Card saved to vocabulary';
    }, formStatus);
  });

  document.querySelector('a[href="#vocabulary"]').addEventListener('click', () => { panel.open = true; });

  panel.addEventListener('toggle', () => {
    if (panel.open) void perform(refresh);
  });

  start.addEventListener('click', () => void perform(showNext));
  sourceButton.addEventListener('click', () => {
    const card = activeCard;
    if (card?.lessonId) void openContext(card.lessonId, card.time);
  });
  reveal.addEventListener('click', () => {
    back.hidden = false;
    reveal.hidden = true;
    document.querySelector('#review-pass').focus();
  });

  for (const [id, remembered] of [['review-pass', true], ['review-retry', false]]) {
    document.querySelector(`#${id}`).addEventListener('click', () => {
      const card = activeCard;
      if (!card) return;
      void perform(async () => {
        await reviewVocabulary(card.id, current => current.due === card.due ? scheduleReview(current, remembered) : current);
        await showNext();
        if (!activeCard) start.focus();
      });
    });
  }
  return () => perform(refresh);
}
