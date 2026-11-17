// The host page sits under the web views. It draws the login banner, the toolbar and the
// scroll bar of the columns, and tells the main process where the web views go.
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

const sections = {
  login: byId('login'),
  deck: byId('deck'),
  error: byId('error'),
};
const loginArea = byId('login-area');
const columnsArea = byId('columns');
const spacer = byId('spacer');
const darkModeSwitch = buttonById('dark-mode');
const hideAdsSwitch = buttonById('hide-ads');
const versionSlot = byId('version');

let currentMode: XDeckIpc.HostState['mode'] = 'loading';

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
    window.xdeckHost.reportLayout({
      // clientWidth/clientHeight leave out the scroll bar, so it stays visible under the views.
      area: { x: rect.left, y: rect.top, width: area.clientWidth, height: area.clientHeight },
      scrollLeft: area === columnsArea ? columnsArea.scrollLeft : 0,
    });
  });
}

function setSwitch(button: HTMLButtonElement, isOn: boolean): void {
  button.setAttribute('aria-checked', String(isOn));
}

function renderVersion(version: XDeckIpc.VersionInfo): void {
  versionSlot.replaceChildren();
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

  switch (state.mode) {
    case 'login': {
      byId('login-banner').hidden = state.accountLabel === null;
      byId('login-label').textContent =
        state.accountLabel === null ? '' : `Log in to 𝕏 for account: ${state.accountLabel}`;
      byId('skip').hidden = !state.canSkip;
      break;
    }
    case 'deck': {
      spacer.style.width = `${state.contentWidth}px`;
      setSwitch(darkModeSwitch, state.isDarkMode);
      darkModeSwitch.disabled = state.isDarkModeUpdating;
      setSwitch(hideAdsSwitch, state.hideAds);
      byId('fit-hint').hidden = !state.isWindowFittingEnabled;
      renderVersion(state.version);
      break;
    }
    case 'error': {
      byId('error-message').textContent = state.message;
      byId('error-path').textContent = state.settingsPath;
      break;
    }
    case 'loading':
      break;
  }
  reportLayout();
}

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
onClick('github', { type: 'open-link', link: 'github' });
onClick('sponsor', { type: 'open-link', link: 'sponsor' });
onClick('open-settings', { type: 'open-settings-folder' });
