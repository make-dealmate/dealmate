const dialog = document.querySelector('#auth-dialog');
const trigger = document.querySelector('.auth-trigger');
const message = document.querySelector('#auth-message');
const retry = document.querySelector('#auth-retry');
const logout = document.querySelector('#auth-logout');
const kakaoButton = document.querySelector('#kakao-signin');
let providers = { google: true, kakao: false };
let currentSession = { user: null };
let user = null;
let expiresTimer;
let initializePromise;
let googleReady = false;
let googleButtonWidth = 0;
let busy = false;

function setMessage(text = '', error = false) {
  message.textContent = text;
  message.dataset.error = String(error);
  retry.hidden = !error;
}

function updateSession(data) {
  currentSession = data;
  user = data.user;
  trigger.textContent = user ? '내 계정' : '로그인';
  trigger.dataset.signedIn = String(Boolean(user));
  document.querySelector('#auth-signed-out').hidden = Boolean(user);
  document.querySelector('#auth-signed-in').hidden = !user;
  document.querySelector('#auth-title').textContent = user ? '반가워요, 메이트.' : '내 계정으로, Dealmate에.';
  const providerName = data.provider === 'kakao' ? '카카오' : 'Google';
  document.querySelector('#auth-description').textContent = user ? `${providerName} 계정으로 로그인되었습니다.`
    : (providers.kakao ? 'Google 또는 카카오 계정으로 간편하게 로그인하세요.' : 'Google 계정으로 간편하게 로그인하세요.');
  document.querySelector('#auth-name').textContent = user?.name || (user ? '메이트' : '');
  document.querySelector('#auth-email').textContent = user?.email || '';
  document.querySelector('#auth-email').hidden = !user?.email;
  document.querySelector('#auth-data-note').textContent = providers.kakao
    ? 'Google은 이름·이메일, 카카오는 회원 식별값으로 로그인 상태를 확인합니다.\n별도의 회원 명부에는 저장하지 않습니다.'
    : '이름과 이메일로 로그인 상태를 확인합니다.\n별도의 회원 명부에는 저장하지 않습니다.';
  document.querySelector('.auth-avatar').textContent = [...(user?.name || 'D')][0];
  clearTimeout(expiresTimer);
  if (user && data.expiresAt) {
    expiresTimer = setTimeout(() => {
      updateSession({ user: null });
      if (dialog.open) setMessage('로그인 시간이 만료되었습니다. 새로고침 후 다시 로그인해주세요.', true);
    }, Math.max(0, data.expiresAt - Date.now()));
  }
}

async function requestAuth(method = 'GET', body, suffix = '') {
  const response = await fetch(`/api/auth${suffix}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Dealmate-Auth': '1' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'unavailable');
  return data;
}

function loadGoogle() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timer = setTimeout(() => reject(new Error('google_unavailable')), 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('google_unavailable')); };
    document.head.append(script);
  });
}

async function signIn(result) {
  if (busy) return;
  busy = true;
  setMessage('로그인을 확인하고 있어요.');
  try {
    const data = await requestAuth('POST', { credential: result.credential });
    updateSession(data);
    setMessage();
    if (!dialog.open) dialog.showModal();
    document.querySelector('#auth-continue').focus();
  } catch (error) {
    const text = error.message === 'login_expired'
      ? '로그인 요청 시간이 만료되었어요. 새로고침 후 다시 시도해주세요.'
      : '로그인을 확인하지 못했어요. 연결 상태와 Google 설정을 확인한 뒤 다시 시도해주세요.';
    setMessage(text, true);
  } finally {
    busy = false;
  }
}

async function initializeGoogle() {
  // Initialize GIS once per page. A fresh page obtains a fresh one-time nonce.
  const [challenge] = await Promise.all([requestAuth('GET', null, '?action=challenge'), loadGoogle()]);
  window.google.accounts.id.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, callback: signIn, ux_mode: 'popup', auto_select: false });
  googleReady = true;
  renderGoogleButton();
}

function renderGoogleButton() {
  if (!googleReady || !dialog.open || user) return;
  const container = document.querySelector('#google-signin');
  const width = Math.min(352, container.clientWidth);
  if (!width || width === googleButtonWidth) return;
  googleButtonWidth = width;
  container.replaceChildren();
  window.google.accounts.id.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko', width });
}

new ResizeObserver(renderGoogleButton).observe(document.querySelector('#google-signin'));

const providersReady = requestAuth('GET', null, '?action=providers').then(data => {
  providers = { google: true, kakao: data.kakao === true };
  kakaoButton.hidden = !providers.kakao;
  updateSession(currentSession);
}).catch(() => {});

async function openAuth() {
  document.querySelector('.menu-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('.menu-toggle').setAttribute('aria-label', '메뉴 열기');
  document.querySelector('.navigation').classList.remove('is-open');
  dialog.showModal();
  setMessage();
  let sessionLoaded = false;
  try {
    const [session] = await Promise.all([requestAuth(), providersReady]);
    updateSession(session);
    sessionLoaded = true;
    if (!user) {
      setMessage('Google 로그인 버튼을 불러오고 있어요.');
      initializePromise ??= initializeGoogle().catch(error => { initializePromise = null; throw error; });
      await initializePromise;
      renderGoogleButton();
      setMessage();
    }
  } catch {
    setMessage(sessionLoaded && providers.kakao ? 'Google 로그인을 불러오지 못했어요. 카카오 로그인은 이용할 수 있습니다.'
      : '로그인 연결을 불러오지 못했어요. 잠시 후 새로고침해주세요.', true);
  }
}
trigger.addEventListener('click', openAuth);

kakaoButton.addEventListener('click', async () => {
  if (busy || !providers.kakao) return;
  busy = true;
  kakaoButton.disabled = true;
  setMessage('카카오 로그인 화면으로 이동하고 있어요.');
  try {
    const data = await requestAuth('POST', {}, '?action=kakao-start');
    const target = new URL(data.redirect);
    if (target.origin !== 'https://kauth.kakao.com' || target.pathname !== '/oauth/authorize') throw new Error('invalid_redirect');
    window.location.assign(target.href);
  } catch {
    busy = false;
    kakaoButton.disabled = false;
    setMessage('카카오 로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.', true);
  }
});

document.querySelector('.auth-close').addEventListener('click', () => dialog.close());
document.querySelector('#auth-continue').addEventListener('click', () => { dialog.close(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
retry.addEventListener('click', () => window.location.reload());
logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await requestAuth('DELETE');
    window.google?.accounts?.id?.disableAutoSelect();
    // Reload removes the account display and acquires a new nonce for a later login.
    window.location.reload();
  } catch {
    setMessage('로그아웃하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.', true);
    logout.disabled = false;
  }
});

async function restoreSession() {
  const result = new URLSearchParams(window.location.hash.slice(1)).get('auth');
  if (['kakao-success', 'kakao-cancelled', 'kakao-error'].includes(result)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    await openAuth();
    if (result === 'kakao-cancelled') setMessage('카카오 로그인을 취소했습니다.');
    else if (result !== 'kakao-success' || !user) setMessage('카카오 로그인을 확인하지 못했어요. 다시 시도해주세요.', true);
    else document.querySelector('#auth-continue').focus();
  } else {
    requestAuth().then(updateSession).catch(() => {});
  }
}
restoreSession();
window.addEventListener('focus', () => {
  if (!dialog.open && !busy) requestAuth().then(updateSession).catch(() => {});
});
