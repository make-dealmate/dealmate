const dialog = document.querySelector('#auth-dialog');
const trigger = document.querySelector('.auth-trigger');
const message = document.querySelector('#auth-message');
const retry = document.querySelector('#auth-retry');
const logout = document.querySelector('#auth-logout');
let user = null;
let expiresTimer;
let initializePromise;
let busy = false;

function setMessage(text = '', error = false) {
  message.textContent = text;
  message.dataset.error = String(error);
  retry.hidden = !error;
}

function updateSession(data) {
  user = data.user;
  trigger.textContent = user ? '내 계정' : '로그인';
  trigger.dataset.signedIn = String(Boolean(user));
  document.querySelector('#auth-signed-out').hidden = Boolean(user);
  document.querySelector('#auth-signed-in').hidden = !user;
  document.querySelector('#auth-title').textContent = user ? '반가워요, 메이트.' : '내 계정으로, Dealmate에.';
  document.querySelector('#auth-description').textContent = user ? 'Google 계정으로 로그인되었습니다.' : 'Google 계정으로 간편하게 로그인하세요.';
  document.querySelector('#auth-name').textContent = user?.name || (user ? '메이트' : '');
  document.querySelector('#auth-email').textContent = user?.email || '';
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
  const container = document.querySelector('#google-signin');
  window.google.accounts.id.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko', width: Math.min(352, container.clientWidth) });
}

trigger.addEventListener('click', async () => {
  document.querySelector('.menu-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('.menu-toggle').setAttribute('aria-label', '메뉴 열기');
  document.querySelector('.navigation').classList.remove('is-open');
  dialog.showModal();
  setMessage();
  try {
    updateSession(await requestAuth());
    if (!user) {
      setMessage('Google 로그인 버튼을 불러오고 있어요.');
      initializePromise ??= initializeGoogle();
      await initializePromise;
      setMessage();
    }
  } catch {
    setMessage('로그인 연결을 불러오지 못했어요. 잠시 후 새로고침해주세요.', true);
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

requestAuth().then(updateSession).catch(() => {});
window.addEventListener('focus', () => {
  if (!dialog.open && !busy) requestAuth().then(updateSession).catch(() => {});
});
