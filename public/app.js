// Card Catalog — static browsing app. No build step, no backend.
// Data contract:
//   data/index.json -> [{ id, name, file, note? }]
//   data/<id>.json  -> { id, name, sets: [{ id, name, cards: [card] }] }
//   card: { name, type?, cost?, text?, stats?, flavor?, extra?: {label: value} }

const state = {
  manifest: [],       // from data/index.json
  loaded: {},          // gameId -> full game object
  activeGame: null,    // gameId
  activeSet: null,     // setId or null (= all sets in game)
  activeCardKey: null, // "gameId::setId::index"
  activeCardName: null,
  history: [],         // stack of cardKeys for random walk back-nav
  focus: 'games',       // 'games' | 'sets' | 'cards' — which column arrow keys act on
  mobileScreen: 'games', // 'games' | 'sets' | 'cards' | 'detail' — drill-down screen on narrow viewports
};

const MOBILE_SCREEN_ORDER = ['games', 'sets', 'cards', 'detail'];

const el = (id) => document.getElementById(id);

async function init() {
  const res = await fetch('data/index.json');
  state.manifest = await res.json();
  renderGameList();
  updateFocusClasses();

  el('search').addEventListener('input', onSearch);
  el('randomBtn').addEventListener('click', () => randomWalk());
  el('randomScopeBtn').addEventListener('click', () => randomInScope());
  el('mobileRandomBtn').addEventListener('click', () => randomWalk());
  el('mobileRandomScopeBtn').addEventListener('click', () => randomInScope());
  el('mobileBackBtn').addEventListener('click', mobileBack);
  document.addEventListener('keydown', onKeyDown);
  setMobileScreen('games');
}

function mobileTitleFor(screen) {
  if (screen === 'games') return 'Card Catalog';
  if (screen === 'sets') return (state.loaded[state.activeGame] || {}).name || '';
  if (screen === 'cards') {
    const game = state.loaded[state.activeGame];
    if (!game) return '';
    if (state.activeSet === null) return 'All sets';
    return (game.sets.find((s) => s.id === state.activeSet) || {}).name || '';
  }
  if (screen === 'detail') return state.activeCardName || '';
  return '';
}

function setMobileScreen(screen) {
  state.mobileScreen = screen;
  el('body').dataset.mobileScreen = screen;
  el('mobileBarTitle').textContent = mobileTitleFor(screen);
  el('mobileBackBtn').disabled = screen === 'games';
}

function mobileBack() {
  const idx = MOBILE_SCREEN_ORDER.indexOf(state.mobileScreen);
  if (idx <= 0) return;
  setMobileScreen(MOBILE_SCREEN_ORDER[idx - 1]);
}

function setFocus(col) {
  state.focus = col;
  updateFocusClasses();
}

function updateFocusClasses() {
  el('gamePane').classList.toggle('focused', state.focus === 'games');
  el('setPane').classList.toggle('focused', state.focus === 'sets');
  el('cardListPane').classList.toggle('focused', state.focus === 'cards');
}

function clampIndex(idx, direction, length) {
  if (length === 0) return -1;
  if (idx === -1) return direction > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, idx + direction));
}

function getSortedGames() {
  return [...state.manifest].sort((a, b) => a.name.localeCompare(b.name));
}

function getSetEntries(game) {
  const sorted = [...game.sets].sort((a, b) => a.name.localeCompare(b.name));
  return [{ id: null, name: 'All sets' }, ...sorted];
}

async function onKeyDown(e) {
  if (document.activeElement === el('search')) return;
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();

  if (e.key === 'ArrowLeft') return moveFocusLeft();
  if (e.key === 'ArrowRight') return moveFocusRight();

  const direction = e.key === 'ArrowDown' ? 1 : -1;

  if (state.focus === 'games') {
    const games = getSortedGames();
    const idx = games.findIndex((g) => g.id === state.activeGame);
    const newIdx = clampIndex(idx, direction, games.length);
    if (newIdx === -1) return;
    await selectGame(games[newIdx].id);
  } else if (state.focus === 'sets') {
    const game = state.loaded[state.activeGame];
    if (!game) return;
    const entries = getSetEntries(game);
    const idx = entries.findIndex((s) => s.id === state.activeSet);
    const newIdx = clampIndex(idx, direction, entries.length);
    if (newIdx === -1) return;
    selectSet(entries[newIdx].id);
  } else if (state.focus === 'cards') {
    cycleCard(direction);
  }
}

// Move to the next/previous card within the current scope (set, or "All sets").
// Shared by the ↑/↓ arrow keys and the big up/down buttons in the mobile inspector.
function cycleCard(direction) {
  const cards = getVisibleCards();
  const idx = cards.findIndex((entry) => cardKey(entry) === state.activeCardKey);
  const newIdx = clampIndex(idx, direction, cards.length);
  if (newIdx === -1) return;
  showCard(cards[newIdx], true);
}

function moveFocusRight() {
  if (state.focus === 'games') {
    if (!state.activeGame) return;
    setFocus('sets');
  } else if (state.focus === 'sets') {
    if (!state.activeGame) return;
    setFocus('cards');
    const cards = getVisibleCards();
    const stillValid = cards.some((entry) => cardKey(entry) === state.activeCardKey);
    if (!stillValid && cards.length > 0) showCard(cards[0], true);
  }
}

function moveFocusLeft() {
  if (state.focus === 'cards') setFocus('sets');
  else if (state.focus === 'sets') setFocus('games');
}

function renderGameList() {
  const list = el('gameList');
  list.innerHTML = '';
  for (const g of getSortedGames()) {
    const row = document.createElement('div');
    row.className = 'game-row' + (state.activeGame === g.id ? ' active' : '');
    const countLabel = state.loaded[g.id] ? countCards(state.loaded[g.id]) : (g.count ?? '');
    row.innerHTML = `<span>${g.name}</span><span class="game-count">${countLabel}</span>`;
    row.addEventListener('click', () => { setFocus('games'); selectGame(g.id); });
    list.appendChild(row);
  }
}

function countCards(game) {
  return game.sets.reduce((sum, s) => sum + s.cards.length, 0);
}

async function selectGame(gameId) {
  if (!state.loaded[gameId]) {
    const manifestEntry = state.manifest.find((g) => g.id === gameId);
    if (!manifestEntry || !manifestEntry.file) return;
    try {
      const res = await fetch(manifestEntry.file);
      state.loaded[gameId] = await res.json();
    } catch (e) {
      console.error('Failed to load game data', gameId, e);
      return;
    }
  }
  state.activeGame = gameId;
  state.activeSet = null;
  renderGameList();
  renderSetList();
  renderCardList();
  setMobileScreen('sets');
}

function renderSetList() {
  const header = el('setPaneHeader');
  const list = el('setList');
  const game = state.loaded[state.activeGame];
  if (!game) {
    header.textContent = '';
    list.innerHTML = '';
    return;
  }
  header.textContent = game.name;
  list.innerHTML = '';

  for (const s of getSetEntries(game)) {
    const row = document.createElement('div');
    row.className = 'set-row' + (state.activeSet === s.id ? ' active' : '');
    const count = s.id === null ? countCards(game) : s.cards.length;
    row.innerHTML = `<span>${s.name}</span><span class="game-count">${count}</span>`;
    row.addEventListener('click', () => { setFocus('sets'); selectSet(s.id); });
    list.appendChild(row);
  }
}

function selectSet(setId) {
  state.activeSet = setId;
  renderSetList();
  renderCardList();
  setMobileScreen('cards');
}

function getVisibleCards() {
  const game = state.loaded[state.activeGame];
  if (!game) return [];
  const sets = state.activeSet ? game.sets.filter((s) => s.id === state.activeSet) : game.sets;
  const out = [];
  for (const s of sets) {
    s.cards.forEach((c, i) => out.push({ card: c, gameId: game.id, setId: s.id, setName: s.name, idx: i }));
  }
  out.sort((a, b) => (a.card.name || '').localeCompare(b.card.name || ''));
  return out;
}

function renderCardList(filterText) {
  const headerEl = el('cardListHeader');
  const listEl = el('cardList');
  const game = state.loaded[state.activeGame];
  if (!game) {
    headerEl.textContent = '';
    listEl.innerHTML = '';
    return;
  }
  let cards = getVisibleCards();
  const q = (filterText || '').trim().toLowerCase();
  if (q) {
    cards = cards.filter(({ card }) =>
      (card.name || '').toLowerCase().includes(q) ||
      (card.text || '').toLowerCase().includes(q)
    );
  }
  headerEl.textContent = `${state.activeSet ? game.sets.find(s => s.id === state.activeSet).name : 'All sets'} (${cards.length} card${cards.length === 1 ? '' : 's'})`;

  listEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const entry of cards) {
    const row = document.createElement('div');
    const key = cardKey(entry);
    row.className = 'card-row' + (state.activeCardKey === key ? ' active' : '');
    row.textContent = entry.card.name;
    row.addEventListener('click', () => { setFocus('cards'); showCard(entry, true); });
    frag.appendChild(row);
  }
  listEl.appendChild(frag);
}

function cardKey(entry) {
  return `${entry.gameId}::${entry.setId}::${entry.idx}`;
}

function onSearch(e) {
  if (state.activeGame) renderCardList(e.target.value);
}

function showCard(entry, pushHistory) {
  if (pushHistory && state.activeCardKey) state.history.push(state.activeCardKey);
  if (state.activeGame !== entry.gameId) {
    // Jumping to a different game (e.g. Random Walk) — reset scope rather than
    // guessing a set. Within the same game, leave the Sets column alone so
    // browsing "All sets" doesn't get silently narrowed by which card you land on.
    state.activeGame = entry.gameId;
    state.activeSet = null;
  }
  state.activeCardKey = cardKey(entry);
  state.activeCardName = entry.card.name;

  renderGameList();
  renderSetList();
  renderCardList(el('search').value);
  setMobileScreen('detail');

  const game = state.loaded[entry.gameId];
  const c = entry.card;

  el('detailEmpty').classList.add('hidden');
  const content = el('detailContent');
  content.classList.remove('hidden');

  const metaItems = [];
  if (c.cost) metaItems.push(c.cost);
  if (c.type) metaItems.push(c.type);
  if (c.stats) metaItems.push(c.stats);

  let extraHtml = '';
  if (c.extra && Object.keys(c.extra).length) {
    extraHtml = Object.entries(c.extra)
      .map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`)
      .join('');
  }

  const visibleCards = getVisibleCards();
  const posIdx = visibleCards.findIndex((entry) => cardKey(entry) === state.activeCardKey);
  const countLabel = posIdx === -1 ? '' : `Card ${posIdx + 1} of ${visibleCards.length}`;

  content.innerHTML = `
    <div class="dc-game">${game.name}</div>
    <div class="dc-set">${entry.setName}</div>
    <div class="dc-name">${c.name}</div>
    <div class="dc-meta">${metaItems.map(m => `<span class="dc-meta-item">${m}</span>`).join('')}</div>
    <div class="dc-text">${c.text || ''}</div>
    ${c.flavor ? `<div class="dc-flavor">${c.flavor}</div>` : ''}
    ${extraHtml ? `<div class="dc-extra">${extraHtml}</div>` : ''}
    <div class="dc-nav">
      <button id="backBtn">&larr; Back</button>
      <button id="nextRandomScopeBtn">🎲 Random card</button>
      <button id="nextRandomBtn">🎲 Random walk</button>
    </div>
    <div class="dc-hint">↑ / ↓ to move through this list · ← / → to switch columns</div>
    <div class="dc-cycle">
      <div class="dc-count">${countLabel}</div>
      <div class="dc-cycle-buttons">
        <button id="prevCardBtn" aria-label="Previous card">&uarr;</button>
        <button id="nextCardBtn" aria-label="Next card">&darr;</button>
      </div>
    </div>
  `;
  el('backBtn').addEventListener('click', goBack);
  el('nextRandomScopeBtn').addEventListener('click', () => randomInScope());
  el('nextRandomBtn').addEventListener('click', () => randomWalk());
  el('prevCardBtn').addEventListener('click', () => cycleCard(-1));
  el('nextCardBtn').addEventListener('click', () => cycleCard(1));

  const activeRow = document.querySelector('.card-row.active');
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
}

function goBack() {
  const prevKey = state.history.pop();
  if (!prevKey) return;
  const [gameId, setId, idxStr] = prevKey.split('::');
  const game = state.loaded[gameId];
  if (!game) return;
  const set = game.sets.find((s) => s.id === setId);
  if (!set) return;
  const idx = parseInt(idxStr, 10);
  showCard({ card: set.cards[idx], gameId, setId, setName: set.name, idx }, false);
}

// "Random card" — stays within the currently selected game/set.
function randomInScope() {
  const pool = getVisibleCards();
  if (pool.length === 0) return;
  const entry = pool[Math.floor(Math.random() * pool.length)];
  setFocus('cards');
  showCard(entry, true);
}

// "Random walk" — jumps to a random card in a random game, loading it if needed.
async function randomWalk() {
  const pick = state.manifest[Math.floor(Math.random() * state.manifest.length)];
  if (!pick) return;
  if (!state.loaded[pick.id]) {
    try {
      const res = await fetch(pick.file);
      state.loaded[pick.id] = await res.json();
    } catch (e) {
      console.error('Failed to load game data', pick.id, e);
      return;
    }
  }
  const game = state.loaded[pick.id];
  const allCards = [];
  for (const s of game.sets) {
    s.cards.forEach((c, i) => allCards.push({ card: c, gameId: game.id, setId: s.id, setName: s.name, idx: i }));
  }
  if (allCards.length === 0) return;
  const entry = allCards[Math.floor(Math.random() * allCards.length)];

  setFocus('cards');
  showCard(entry, true);
}

init();
