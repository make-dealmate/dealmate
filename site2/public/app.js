const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.navigation');

function closeMenu() {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '메뉴 열기');
  navigation.classList.remove('is-open');
}

menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  navigation.classList.toggle('is-open', open);
});

navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('click', event => {
  if (!navigation.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menuToggle.focus();
  }
});
const desktopMedia = window.matchMedia('(min-width: 801px)');
desktopMedia.addEventListener('change', event => { if (event.matches) closeMenu(); });

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectStep(selectedTab, moveFocus = false) {
  tabs.forEach(tab => {
    const selected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  });
  if (moveFocus) selectedTab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectStep(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectStep(tabs[next], true);
    }
  });
});
