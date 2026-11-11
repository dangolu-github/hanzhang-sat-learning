// Course access for Hanzhang's learner pages. The password is checked by the course service and never
// stored here: the browser keeps an opaque trust credential and a short-lived access token.
// Remembered sign-in (2026-11-11): the credential is sent with every request and accepted on its own when
// the short token has gone, so the password is asked for once per browser. It is forgotten only when the
// course says explicitly that this browser is unknown or was signed out; a connection problem keeps it and
// offers to try again.
(() => {
  const trustedBrowserKey = 'hz-sat-trusted-browser-v1';
  const deviceTokenKey = 'hz-sat-device-token-v1';
  const tokenKey = 'hz-sat-access-token';
  const expiryKey = 'hz-sat-access-expires-at';
  const config = window.HZ_PORTAL_CONFIG || {};
  let resolveReady;
  let renewal = null;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const readStorage = (storage, key) => {
    try { return storage.getItem(key) || ''; }
    catch { return ''; }
  };
  const writeStorage = (storage, key, value) => {
    try { storage.setItem(key, value); return true; }
    catch { return false; }
  };
  const removeStorage = (storage, key) => {
    try { storage.removeItem(key); } catch { /* nothing stored */ }
  };
  // Only an explicit answer from the course ends a remembered browser (the error carries `reason`).
  const forgetBrowser = () => {
    removeStorage(window.localStorage, deviceTokenKey);
    removeStorage(window.localStorage, trustedBrowserKey);
    removeStorage(window.sessionStorage, tokenKey);
    removeStorage(window.sessionStorage, expiryKey);
  };
  const getToken = () => readStorage(window.sessionStorage, tokenKey);
  const getDeviceToken = () => readStorage(window.localStorage, deviceTokenKey);

  const setAccess = (token, deviceToken, expiresIn) => {
    if (token) writeStorage(window.sessionStorage, tokenKey, token);
    if (token) writeStorage(window.sessionStorage, expiryKey, String(Date.now() + Number(expiresIn || 21600) * 1000));
    writeStorage(window.localStorage, trustedBrowserKey, 'granted');
    if (deviceToken) writeStorage(window.localStorage, deviceTokenKey, deviceToken);
  };

  const consumeTrustedDevice = () => {
    try {
      const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = String(parameters.get('hz-trusted-device') || '').replace(/[^a-f0-9]/gi, '').slice(0, 128);
      if (!token) return '';
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }
    catch { return ''; }
  };

  // JSONP read: Apps Script web apps answer GET requests from any origin this way.
  const requestData = (action, parameters) => new Promise((resolve, reject) => {
    if (!config.endpoint) { reject(new Error('The course service is not connected yet.')); return; }
    const callbackName = `__hzPortal${Date.now()}${Math.random().toString(16).slice(2)}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('The course service did not answer. Check your connection and try again.')); }, 20000);
    const cleanup = () => { window.clearTimeout(timeout); delete window[callbackName]; script.remove(); };
    window[callbackName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('The course service could not be reached.')); };
    const query = new URLSearchParams(Object.assign({}, parameters, { action, callback: callbackName, _: String(Date.now()) }));
    script.src = `${config.endpoint}?${query.toString()}`;
    document.head.appendChild(script);
  });

  // A refusal from the course carries `reason` ('unknown' or 'revoked'); a request that never got an answer
  // does not, and is never taken as a refusal.
  const requestAccess = async (action, parameters) => {
    const data = await requestData(action, parameters);
    if (!data || !data.ok || !data.accessToken) {
      const error = new Error((data && data.error) || 'Access could not be confirmed.');
      if (data && (data.reason === 'unknown' || data.reason === 'revoked')) error.reason = data.reason;
      throw error;
    }
    return data;
  };
  const authorize = (code) => requestAccess('authorizeAccess', { code });
  const renewAccess = (deviceToken) => requestAccess('renewAccess', { deviceToken });
  const OFFLINE = 'We could not reach your course. Check your connection and try again. 暂时无法连接，请检查网络后重试。';
  const AGAIN = 'Please enter the course password again. Nothing you saved is lost. 请重新输入课程密码，已保存的内容不会丢失。';

  async function ensureFreshAccess(force) {
    if (renewal) return renewal;
    const token = getToken();
    const expiresAt = Number(readStorage(window.sessionStorage, expiryKey));
    if (!force && token && expiresAt > Date.now() + 60000) return token;
    const device = getDeviceToken();
    if (!device) {
      showGate();
      throw new Error(AGAIN);
    }
    renewal = renewAccess(device).then((access) => {
      setAccess(access.accessToken, device, access.expiresIn);
      reveal();
      resolveReady();
      return access.accessToken;
    }).catch((error) => {
      if (error && error.reason) {
        forgetBrowser();
        showGate();
        throw new Error(AGAIN);
      }
      // No answer: the remembered browser stays remembered. The old token still goes with the credential,
      // which the course accepts on its own.
      if (!force && token) return token;
      throw new Error(OFFLINE);
    }).finally(() => { renewal = null; });
    return renewal;
  }

  async function request(action, parameters) {
    let token = await ensureFreshAccess(false);
    let data = await requestData(action, Object.assign({}, parameters, { accessToken: token, deviceToken: getDeviceToken() }));
    if (data && !data.ok && /course access expired/i.test(data.error || '')) {
      token = await ensureFreshAccess(true);
      data = await requestData(action, Object.assign({}, parameters, { accessToken: token, deviceToken: getDeviceToken() }));
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'The request could not be confirmed. Please try again.');
    return data;
  }

  // Write: the response is opaque (no-cors), so callers confirm the result with a JSONP read.
  async function post(action, payload) {
    // The Edit annotations button needs the address of its page back, so that one is a read.
    if (action === 'createPaperAnnotationLink') return request(action, payload);
    if (!config.endpoint) throw new Error('The course service is not connected yet.');
    const token = await ensureFreshAccess(false);
    const response = await fetch(config.endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({}, payload, { action, accessToken: token, deviceToken: getDeviceToken() }))
    });
    if (response.type !== 'opaque' && !response.ok) throw new Error('The request could not be sent.');
    return true;
  }

  window.HanzhangAccess = { ready, ensureFreshAccess, request, post, getToken, siteUrl: config.siteUrl || '' };

  const reveal = () => {
    document.body.dataset.access = 'granted';
    document.documentElement.classList.remove('access-pending');
    document.body.classList.remove('access-locked');
    document.querySelectorAll('body > [inert]').forEach((node) => { node.inert = false; });
    document.querySelector('.access-gate')?.remove();
  };

  const showGate = () => {
    if (document.querySelector('.access-gate')) return;
    document.body.dataset.access = 'locked';
    document.body.classList.add('access-locked');
    Array.from(document.body.children).forEach((node) => { node.inert = true; });
    const gate = document.createElement('div');
    gate.className = 'access-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'access-title');
    gate.innerHTML = `
      <form class="access-card">
        <p class="access-kicker">Hanzhang · SAT Reading &amp; Writing</p>
        <h1 id="access-title">Welcome back</h1>
        <p>Enter your course password. 请输入课程密码。</p>
        <label for="course-password">Password</label>
        <div class="access-row">
          <input id="course-password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">Continue</button>
        </div>
        <p class="access-error" role="alert" aria-live="polite"></p>
      </form>`;
    document.body.append(gate);
    gate.inert = false;
    document.documentElement.classList.remove('access-pending');
    const form = gate.querySelector('form');
    const input = gate.querySelector('input');
    const error = gate.querySelector('.access-error');
    input.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Opening…';
      try {
        const access = await authorize(input.value.trim());
        setAccess(access.accessToken, access.deviceToken, access.expiresIn);
      } catch (accessError) {
        const message = (accessError && accessError.message) || '';
        const wrong = /incorrect course password/i.test(message);
        error.textContent = wrong ? 'That password does not match. Please try again. 密码不正确，请重试。'
          : /too many attempts/i.test(message) ? 'Too many tries. Please wait a few minutes and try again. 尝试次数过多，请几分钟后再试。'
            : 'We could not connect to your course. Check your connection and try again. 暂时无法连接，请检查网络后重试。';
        if (wrong) input.select();
        button.disabled = false;
        button.textContent = wrong ? 'Continue' : 'Try again';
        return;
      }
      reveal();
      resolveReady();
    });
  };

  // A remembered browser that cannot reach the course right now is offered another try, never the
  // password box: nothing is forgotten until the course itself says so.
  const showRetry = (retry) => {
    document.querySelector('.access-gate')?.remove();
    document.body.dataset.access = 'locked';
    document.body.classList.add('access-locked');
    Array.from(document.body.children).forEach((node) => { node.inert = true; });
    const gate = document.createElement('div');
    gate.className = 'access-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'access-title');
    gate.innerHTML = `
      <div class="access-card">
        <p class="access-kicker">Hanzhang · SAT Reading &amp; Writing</p>
        <h1 id="access-title">Welcome back</h1>
        <p>${OFFLINE}</p>
        <div class="access-row"><button type="button">Try again</button></div>
      </div>`;
    document.body.append(gate);
    gate.inert = false;
    document.documentElement.classList.remove('access-pending');
    const button = gate.querySelector('button');
    button.focus();
    button.addEventListener('click', () => { button.disabled = true; button.textContent = 'Opening…'; retry(); });
  };

  const trustedDevice = consumeTrustedDevice() || getDeviceToken();
  if (trustedDevice) {
    const start = () => renewAccess(trustedDevice).then((access) => {
      setAccess(access.accessToken, trustedDevice, access.expiresIn);
      reveal();
      resolveReady();
    }).catch((error) => {
      if (error && error.reason) { forgetBrowser(); document.querySelector('.access-gate')?.remove(); showGate(); return; }
      showRetry(start);
    });
    start();
    return;
  }
  showGate();
})();
