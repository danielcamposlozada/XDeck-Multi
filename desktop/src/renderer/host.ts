// The host page sits under the web views. It draws the login banner, the column title bars, the
// toolbar, the Columns window and the scroll bar of the columns, and tells the main process where
// the web views go. While a column is dragged, it also animates where every column is.
// A plain script (no imports or exports), so it loads without a module loader.

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}`);
  return element;
}

function buttonById(id: string): HTMLButtonElement {
  const element = byId(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return element;
}

function inputById(id: string): HTMLInputElement {
  const element = byId(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return element;
}

function selectById(id: string): HTMLSelectElement {
  const element = byId(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`#${id} is not a select`);
  return element;
}

// MARK: Icons (24×24, drawn with the text color)

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS: Readonly<Record<string, string>> = {
  forYou: `<path fill="currentColor" d="M12 2.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>`,
  following: `<path ${STROKE} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>`,
  notifications: `<path ${STROKE} d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0"/>`,
  profile: `<g ${STROKE}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></g>`,
  search: `<g ${STROKE}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
  searchQuery: `<g ${STROKE}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
  custom: `<path ${STROKE} d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
  grip: `<path ${STROKE} d="M4 7h16M4 12h16M4 17h16"/>`,
  columns: `<g ${STROKE}><rect x="3" y="5" width="13" height="14" rx="2"/><path d="M9.5 5v14M20 9v6M17 12h6"/></g>`,
  minus: `<path ${STROKE} d="M5 12h14"/>`,
  plus: `<path ${STROKE} d="M12 5v14M5 12h14"/>`,
  refresh: `<path ${STROKE} d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>`,
  fit: `<g ${STROKE}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 12 2-2m-2 2 2 2m-2-2h10m0 0-2-2m2 2-2 2"/></g>`,
  settings: `<g ${STROKE}><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></g>`,
  remove: `<g ${STROKE}><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></g>`,
  up: `<path ${STROKE} d="m6 15 6-6 6 6"/>`,
  down: `<path ${STROKE} d="m6 9 6 6 6-6"/>`,
  addAccount: `<g ${STROKE}><circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0 1 13-6.2M19 15v6M16 18h6"/></g>`,
  close: `<path ${STROKE} d="M6 6l12 12M18 6 6 18"/>`,
  check: `<g ${STROKE}><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></g>`,
  warning: `<g ${STROKE}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></g>`,
};

function iconElement(name: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.dataset.icon = name;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`;
  return span;
}

function fillStaticIcons(): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = element.dataset.icon ?? '';
    if (element.childElementCount === 0) element.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`;
  }
}

// MARK: Elements and state

const sections = {
  login: byId('login'),
  deck: byId('deck'),
  dialog: byId('columns-dialog'),
  error: byId('error'),
};
const loginArea = byId('login-area');
const columnsArea = byId('columns');
const content = byId('content');
const titles = byId('titles');
const darkModeSwitch = buttonById('dark-mode');
const hideAdsSwitch = buttonById('hide-ads');
const versionSlot = byId('version');
const zoomReset = buttonById('zoom-reset');

let currentMode: XDeckIpc.HostState['mode'] = 'loading';
let deckState: Extract<XDeckIpc.HostState, { mode: 'deck' }> | null = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function titleHeight(): number {
  return titles.getBoundingClientRect().height;
}

function activeArea(): HTMLElement | null {
  if (currentMode === 'login') return loginArea;
  if (currentMode === 'deck') return columnsArea;
  return null;
}

let reportScheduled = false;
function reportLayout(): void {
  if (reportScheduled) return;
  reportScheduled = true;
  requestAnimationFrame(() => {
    reportScheduled = false;
    const area = activeArea();
    if (area === null) return;
    const rect = area.getBoundingClientRect();
    // The web views go under the column title bars.
    const top = area === columnsArea ? titleHeight() : 0;
    window.xdeckHost.reportLayout({
      // clientWidth/clientHeight leave out the scroll bar, so it stays visible under the views.
      area: { x: rect.left, y: rect.top + top, width: area.clientWidth, height: area.clientHeight - top },
      scrollLeft: area === columnsArea ? columnsArea.scrollLeft : 0,
    });
  });
}

function setSwitch(button: HTMLButtonElement, isOn: boolean): void {
  button.setAttribute('aria-checked', String(isOn));
}

function renderVersion(version: XDeckIpc.VersionInfo): void {
  versionSlot.replaceChildren();
  versionSlot.classList.remove('group');
  if (version.latest !== null) {
    const text = document.createElement('span');
    text.textContent = `v${version.current} (v${version.latest} is available)`;
    const update = document.createElement('button');
    update.type = 'button';
    update.className = 'bordered';
    update.textContent = 'Update';
    update.addEventListener('click', () => {
      window.xdeckHost.send({ type: 'open-link', link: 'latest-release' });
    });
    versionSlot.classList.add('group');
    versionSlot.append(text, update);
  } else {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link';
    link.textContent = `v${version.current}${version.isDev ? ' (dev)' : ''}`;
    link.addEventListener('click', () => {
      window.xdeckHost.send({ type: 'open-link', link: 'release' });
    });
    versionSlot.append(link);
  }
}

// MARK: Title bars

const titleBars = new Map<number, HTMLElement>();

function titleBarFor(info: XDeckIpc.ColumnInfo): HTMLElement {
  let bar = titleBars.get(info.id);
  if (bar === undefined) {
    bar = document.createElement('div');
    bar.className = 'title-bar';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'listitem');
    bar.dataset.id = String(info.id);
    bar.title = 'Drag to move this column. Right-click for more.';
    attachDrag(bar, info.id);
    titleBars.set(info.id, bar);
    titles.append(bar);
  }
  return bar;
}

function renderTitleBars(columns: readonly XDeckIpc.ColumnInfo[]): void {
  const ids = new Set(columns.map((column) => column.id));
  for (const [id, bar] of titleBars) {
    if (!ids.has(id)) {
      bar.remove();
      titleBars.delete(id);
    }
  }
  for (const info of columns) {
    const bar = titleBarFor(info);
    const children = [iconElement('grip', 'grip'), iconElement(info.icon, 'type-icon')];
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = info.title;
    children.push(title);
    if (info.handle !== null) {
      const handle = document.createElement('span');
      handle.className = 'handle';
      handle.textContent = info.handle;
      children.push(handle);
    }
    bar.replaceChildren(...children);
    bar.setAttribute(
      'aria-label',
      `${info.title}${info.handle === null ? '' : `, ${info.handle}`}. Alt+Left or Alt+Right to move.`,
    );
    bar.hidden = info.width <= 0;
    // While a column is dragged, the drag animation places the title bars.
    if (drag === null) {
      bar.style.left = `${info.x}px`;
      bar.style.width = `${info.width}px`;
    }
  }
}

// MARK: Dragging a column

interface Drag {
  id: number;
  pointerId: number;
  startX: number;
  /** Has moved far enough to count as a drag. */
  started: boolean;
  order: number[];
  widths: Map<number, number>;
  /** Width of the slots the column has passed, subtracted from the pointer's travel. */
  shift: number;
  offset: number;
  /** Where each title bar is drawn right now (content coordinates). */
  shown: Map<number, number>;
  dropping: boolean;
  slot: HTMLElement;
}

let drag: Drag | null = null;
let animationFrame = 0;

/** Where each column's slot starts with the drag's current order. */
function slotPositions(current: Drag): Map<number, number> {
  const positions = new Map<number, number>();
  let x = 0;
  for (const id of current.order) {
    positions.set(id, x);
    x += current.widths.get(id) ?? 0;
  }
  return positions;
}

function swapWhilePastMiddle(current: Drag, translation: number): void {
  current.offset = translation - current.shift;
  for (;;) {
    const index = current.order.indexOf(current.id);
    const neighborIndex = current.offset > 0 ? index + 1 : index - 1;
    const neighborId = current.order[neighborIndex];
    if (neighborId === undefined) break;
    const neighborWidth = current.widths.get(neighborId) ?? 0;
    if (Math.abs(current.offset) <= neighborWidth / 2) break;
    current.order[index] = neighborId;
    current.order[neighborIndex] = current.id;
    current.shift += current.offset > 0 ? neighborWidth : -neighborWidth;
    current.offset = translation - current.shift;
  }
}

/** Moves every title bar a step toward its place, then tells the main process. */
function animateDrag(): void {
  animationFrame = 0;
  const current = drag;
  if (current === null) return;
  const slots = slotPositions(current);
  const ease = reduceMotion.matches ? 1 : 0.3;
  let settled = true;
  for (const [id, slotX] of slots) {
    const target = id === current.id && !current.dropping ? slotX + current.offset : slotX;
    // The dragged column follows the pointer exactly; the others glide to their new place.
    const follow = id === current.id && !current.dropping ? 1 : ease;
    const previous = current.shown.get(id) ?? target;
    let next = previous + (target - previous) * follow;
    if (Math.abs(target - next) < 0.5) next = target;
    else settled = false;
    current.shown.set(id, next);
    const bar = titleBars.get(id);
    if (bar !== undefined) {
      bar.style.left = `${next}px`;
      bar.style.width = `${current.widths.get(id) ?? 0}px`;
    }
  }
  const dropX = slots.get(current.id) ?? 0;
  current.slot.style.left = `${dropX + 6}px`;
  current.slot.style.width = `${Math.max(0, (current.widths.get(current.id) ?? 0) - 12)}px`;
  window.xdeckHost.reportDragFrame({
    draggedId: current.id,
    positions: [...current.shown].map(([id, x]) => ({ id, x })),
  });

  if (current.dropping && settled) {
    finishDrop(current);
    return;
  }
  if (!settled || current.dropping) scheduleAnimation();
}

function scheduleAnimation(): void {
  if (animationFrame === 0) animationFrame = requestAnimationFrame(animateDrag);
}

function finishDrop(current: Drag): void {
  titleBars.get(current.id)?.classList.remove('dragging');
  current.slot.remove();
  drag = null;
  const original = deckState?.columns.map((column) => column.id) ?? [];
  const changed = current.order.some((id, index) => id !== original[index]);
  if (changed) {
    // The main process saves the order and sends the new positions, which match where the
    // title bars already are, so nothing is redrawn from the old order meanwhile.
    window.xdeckHost.send({ type: 'reorder-columns', order: current.order });
  } else {
    window.xdeckHost.reportDragFrame(null);
    if (deckState !== null) renderTitleBars(deckState.columns);
  }
}

function attachDrag(bar: HTMLElement, id: number): void {
  bar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag !== null || deckState === null) return;
    const visible = deckState.columns.filter((column) => column.width > 0);
    if (visible.length < 2 || deckState.columns.some((column) => column.width <= 0)) return;
    bar.setPointerCapture(event.pointerId);
    const slot = document.createElement('div');
    slot.className = 'drop-slot';
    drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      started: false,
      order: deckState.columns.map((column) => column.id),
      widths: new Map(deckState.columns.map((column) => [column.id, column.width])),
      shift: 0,
      offset: 0,
      shown: new Map(deckState.columns.map((column) => [column.id, column.x])),
      dropping: false,
      slot,
    };
  });
  bar.addEventListener('pointermove', (event) => {
    const current = drag;
    if (current === null || current.id !== id || current.pointerId !== event.pointerId || current.dropping) return;
    const translation = event.clientX - current.startX;
    if (!current.started) {
      if (Math.abs(translation) < 4) return;
      current.started = true;
      bar.classList.add('dragging');
      titles.prepend(current.slot);
    }
    swapWhilePastMiddle(current, translation);
    scheduleAnimation();
  });
  const endDrag = (event: PointerEvent): void => {
    const current = drag;
    if (current === null || current.id !== id || current.pointerId !== event.pointerId) return;
    if (!current.started) {
      drag = null;
      return;
    }
    current.dropping = true;
    scheduleAnimation();
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.xdeckHost.send({ type: 'column-menu', id });
  });
  bar.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    window.xdeckHost.send({ type: 'move-column', id, delta: event.key === 'ArrowLeft' ? -1 : 1 });
  });
}

// MARK: Columns window

const newType = selectById('new-type');
const newAccount = selectById('new-account');
const NEW_ACCOUNT = '\u0000new';
const DEFAULT_ACCOUNT = '\u0000default';
let dialogWasOpen = false;

function updateAddForm(): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-for-type]')) {
    element.hidden = element.dataset.forType !== newType.value;
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-for-account]')) {
    element.hidden = newAccount.value !== NEW_ACCOUNT;
  }
}

function renderDialog(dialog: XDeckIpc.ColumnsDialog): void {
  const rows = byId('dialog-rows');
  rows.replaceChildren(
    ...dialog.rows.map((row, index) => {
      const item = document.createElement('li');
      item.className = 'dialog-row';
      const text = document.createElement('div');
      text.className = 'text';
      const title = document.createElement('div');
      title.textContent = row.title;
      text.append(title);
      if (row.subtitle !== null) {
        const subtitle = document.createElement('div');
        subtitle.className = 'subtitle';
        subtitle.textContent = row.subtitle;
        text.append(subtitle);
      }
      item.append(iconElement(row.icon, 'type-icon'), text);
      if (row.account !== null) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = row.account;
        item.append(chip);
      }
      const button = (icon: string, label: string, disabled: boolean, action: XDeckIpc.HostAction): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'icon-button';
        element.title = label;
        element.setAttribute('aria-label', `${label}: ${row.title}`);
        element.disabled = disabled;
        element.append(iconElement(icon, ''));
        element.addEventListener('click', () => {
          window.xdeckHost.send(action);
        });
        return element;
      };
      item.append(
        button('up', 'Move up', index === 0, { type: 'columns-move', index, delta: -1 }),
        button('down', 'Move down', index === dialog.rows.length - 1, { type: 'columns-move', index, delta: 1 }),
        button('remove', 'Remove column', false, { type: 'columns-remove', index }),
      );
      return item;
    }),
  );

  // Account choices: the default session, the accounts already used, and a new one.
  const previous = newAccount.value;
  const options = [
    new Option('Default', DEFAULT_ACCOUNT),
    ...dialog.accounts.map((name) => new Option(name, name)),
    new Option('New account…', NEW_ACCOUNT),
  ];
  newAccount.replaceChildren(...options);
  newAccount.value = options.some((option) => option.value === previous) ? previous : DEFAULT_ACCOUNT;
  updateAddForm();

  const error = byId('dialog-error');
  error.hidden = dialog.error === null;
  error.textContent = dialog.error ?? '';
  buttonById('dialog-save').disabled = dialog.rows.length === 0;
  if (!dialogWasOpen) newType.focus();
}

byId('add-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const columnType = newType.value as XDeckIpc.NewColumnType;
  const text =
    columnType === 'search' ? inputById('new-search').value : columnType === 'custom' ? inputById('new-url').value : '';
  let account: string | null = null;
  if (newAccount.value === NEW_ACCOUNT) {
    account = inputById('new-account-name').value.trim();
    if (account === '') {
      inputById('new-account-name').focus();
      return;
    }
  } else if (newAccount.value !== DEFAULT_ACCOUNT) {
    account = newAccount.value;
  }
  window.xdeckHost.send({ type: 'columns-add', columnType, text, account });
  inputById('new-search').value = '';
  inputById('new-url').value = '';
  if (account !== null && newAccount.value === NEW_ACCOUNT) {
    inputById('new-account-name').value = '';
    // The new account shows up in the list; keep it selected for the next column.
    setTimeout(() => {
      if ([...newAccount.options].some((option) => option.value === account)) newAccount.value = account;
      updateAddForm();
    }, 50);
  }
});
newType.addEventListener('change', updateAddForm);
newAccount.addEventListener('change', updateAddForm);
sections.dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.xdeckHost.send({ type: 'columns-cancel' });
});

// MARK: Download notice

function renderNotice(notice: XDeckIpc.Notice | null): void {
  byId('notice').hidden = notice === null;
  if (notice === null) return;
  byId('notice-text').textContent = notice.text;
  byId('notice-text').title = notice.text;
  byId('notice-show').hidden = !notice.canShowFile;
  const icon = byId('notice-icon');
  icon.className = `notice-icon ${notice.isWorking ? 'working' : notice.isError ? 'failed' : 'done'}`;
  icon.replaceChildren();
  if (!notice.isWorking) icon.append(iconElement(notice.isError ? 'warning' : 'check', ''));
}

// MARK: Render

function render(state: XDeckIpc.HostState): void {
  currentMode = state.mode;
  document.documentElement.style.setProperty('--background', state.background);
  document.documentElement.classList.toggle(
    'dark',
    state.mode === 'loading' ? state.background !== '#FFFFFF' : state.mode !== 'error' && state.isDarkMode,
  );
  sections.login.hidden = state.mode !== 'login';
  sections.deck.hidden = state.mode !== 'deck';
  sections.error.hidden = state.mode !== 'error';
  sections.dialog.hidden = state.mode !== 'deck' || state.dialog === null;

  switch (state.mode) {
    case 'login': {
      deckState = null;
      byId('login-banner').hidden = state.accountLabel === null;
      byId('login-label').textContent =
        state.accountLabel === null ? '' : `Sign in to the “${state.accountLabel}” account`;
      byId('login-progress').textContent = [state.progress, 'Each account keeps its own session.']
        .filter((part) => part !== null)
        .join(' · ');
      byId('skip').hidden = !state.canSkip;
      break;
    }
    case 'deck': {
      deckState = state;
      content.style.width = `${state.contentWidth}px`;
      renderTitleBars(state.columns);
      setSwitch(darkModeSwitch, state.isDarkMode);
      darkModeSwitch.disabled = state.isDarkModeUpdating;
      darkModeSwitch.title = state.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode';
      setSwitch(hideAdsSwitch, state.hideAds);
      buttonById('fit-window').hidden = !state.isWindowFittingEnabled;
      zoomReset.textContent = `${state.zoomPercent}%`;
      zoomReset.setAttribute('aria-label', `Zoom ${state.zoomPercent} percent. Reset zoom`);
      buttonById('zoom-in').disabled = !state.canZoomIn;
      buttonById('zoom-out').disabled = !state.canZoomOut;
      renderVersion(state.version);
      renderNotice(state.notice);
      if (state.dialog !== null) renderDialog(state.dialog);
      dialogWasOpen = state.dialog !== null;
      break;
    }
    case 'error': {
      deckState = null;
      byId('error-message').textContent = state.message;
      byId('error-path').textContent = state.settingsPath;
      break;
    }
    case 'loading':
      break;
  }
  reportLayout();
}

fillStaticIcons();
window.xdeckHost.onState(render);
window.xdeckHost.onScrollBy((deltaX) => {
  columnsArea.scrollLeft += deltaX;
});

columnsArea.addEventListener('scroll', reportLayout, { passive: true });
const resizeObserver = new ResizeObserver(reportLayout);
resizeObserver.observe(loginArea);
resizeObserver.observe(columnsArea);

function onClick(id: string, action: XDeckIpc.HostAction): void {
  byId(id).addEventListener('click', () => {
    window.xdeckHost.send(action);
  });
}
onClick('skip', { type: 'skip-login' });
onClick('dark-mode', { type: 'toggle-dark-mode' });
onClick('hide-ads', { type: 'toggle-hide-ads' });
onClick('open-columns', { type: 'columns-open' });
onClick('zoom-in', { type: 'zoom', direction: 'in' });
onClick('zoom-out', { type: 'zoom', direction: 'out' });
onClick('zoom-reset', { type: 'zoom', direction: 'reset' });
onClick('refresh', { type: 'refresh' });
onClick('fit-window', { type: 'fit-window' });
onClick('settings', { type: 'open-settings-folder' });
onClick('github', { type: 'open-link', link: 'github' });
onClick('open-settings', { type: 'open-settings-folder' });
onClick('dialog-cancel', { type: 'columns-cancel' });
onClick('dialog-save', { type: 'columns-save' });
onClick('notice-show', { type: 'show-downloaded-file' });
onClick('notice-dismiss', { type: 'dismiss-notice' });
