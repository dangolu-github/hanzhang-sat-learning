// Online answering on a homework page: choices and short written answers, autosave, one submission,
// automatic checking of multiple-choice items (results shown only when your teacher has checking switched on).
(() => {
  const hw = window.HZ_HOMEWORK;
  if (!hw || !hw.assignmentId) return;
  const items = Array.from(document.querySelectorAll('.hw-item[data-n]'));
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const state = { responses: {}, resetVersion: 0, saveId: '', receiving: true, submitted: null, saving: null, dirty: false };
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  const read = (key) => { try { return storage ? storage.getItem(key) : null; } catch { return null; } };
  const write = (key, value) => { try { if (storage) storage.setItem(key, value); } catch { /* private mode */ } };
  const newId = (prefix) => prefix + '-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(16) + Math.random().toString(16).slice(2));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (name) => `hz-hw-${name}:${hw.assignmentId}:${state.resetVersion}`;

  items.forEach(decorate);
  const bar = document.getElementById('answer-bar');
  const statusEl = bar && bar.querySelector('[data-status]');
  const submitButton = bar && bar.querySelector('[data-action=submit]');
  const resultEl = document.getElementById('answer-result');
  if (submitButton) submitButton.addEventListener('click', submit);
  setStatus('Loading…');
  start();

  function decorate(item) {
    const n = item.dataset.n;
    if (item.dataset.type === 'mc') {
      const list = item.querySelector('.choices');
      if (!list) return;
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', `Question ${n} choices`);
      Array.from(list.children).forEach((li, index) => {
        li.classList.add('hw-choice');
        li.dataset.letter = letters[index];
        li.setAttribute('role', 'radio');
        li.setAttribute('aria-checked', 'false');
        li.tabIndex = 0;
        li.addEventListener('click', () => choose(n, letters[index]));
        li.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(n, letters[index]); }
        });
      });
    } else {
      const box = document.createElement('textarea');
      box.className = 'hw-text';
      box.rows = Number(item.dataset.lines || 2);
      box.maxLength = 1500;
      box.placeholder = 'Type your answer here (or write it on paper). 在这里输入答案。';
      box.setAttribute('aria-label', `Question ${n} answer`);
      box.addEventListener('input', () => { state.responses[n] = box.value; touched(); });
      const anchor = item.querySelector('.workspace') || item.lastElementChild;
      anchor.insertAdjacentElement('beforebegin', box);
    }
  }

  function paintResponses() {
    items.forEach((item) => {
      const n = item.dataset.n;
      const value = state.responses[n] || '';
      if (item.dataset.type === 'mc') {
        item.querySelectorAll('.hw-choice').forEach((li) => {
          const on = li.dataset.letter === value;
          li.classList.toggle('is-selected', on);
          li.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      } else {
        const box = item.querySelector('.hw-text');
        if (box && box.value !== value) box.value = value;
      }
    });
  }

  function answeredCount() {
    return items.filter((item) => String(state.responses[item.dataset.n] || '').trim()).length;
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function choose(n, letter) {
    if (state.submitted || !state.receiving) return;
    state.responses[n] = state.responses[n] === letter ? '' : letter;
    paintResponses();
    touched();
  }

  function touched() {
    write(key('draft'), JSON.stringify(state.responses));
    state.dirty = true;
    setStatus(`${answeredCount()} / ${items.length} answered · saving…`);
    clearTimeout(state.timer);
    state.timer = setTimeout(saveDraft, 1500);
  }

  async function saveDraft() {
    if (!state.dirty || state.submitted) return;
    state.dirty = false;
    try {
      await window.HanzhangAccess.post('saveDraft', { assignmentId: hw.assignmentId, saveId: state.saveId, resetVersion: state.resetVersion, responses: state.responses, clientUpdatedAt: new Date().toISOString() });
      setStatus(`${answeredCount()} / ${items.length} answered · saved`);
    } catch (error) {
      state.dirty = true;
      setStatus(`${answeredCount()} / ${items.length} answered · saved on this device only`);
    }
  }

  async function start() {
    try {
      await window.HanzhangAccess.ready;
      const data = await window.HanzhangAccess.request('getOnline', { assignmentId: hw.assignmentId, saveId: read(`hz-hw-save:${hw.assignmentId}`) || '' });
      state.resetVersion = Number(data.resetVersion || 0);
      state.receiving = data.receiving !== false;
      let saveId = read(key('save'));
      if (!saveId) { saveId = newId('save'); write(key('save'), saveId); }
      state.saveId = saveId;
      write(`hz-hw-save:${hw.assignmentId}`, saveId);
      const local = JSON.parse(read(key('draft')) || '{}');
      state.responses = Object.keys(local).length ? local : ((data.draft && data.draft.saveId === saveId && data.draft.responses) || {});
      if (data.submission) {
        state.submitted = data.submission;
        state.responses = data.submission.responses || state.responses;
      }
      paintResponses();
      if (state.submitted) showSubmitted(state.submitted);
      else if (!state.receiving) { setStatus('Online answers are closed for this homework.'); if (submitButton) submitButton.disabled = true; }
      else setStatus(`${answeredCount()} / ${items.length} answered`);
    } catch (error) {
      setStatus((error && error.message) || 'Could not connect. Your answers stay on this device.');
    }
  }

  async function submit() {
    if (state.submitted || !state.receiving) return;
    const blank = items.filter((item) => !String(state.responses[item.dataset.n] || '').trim()).map((item) => item.dataset.n);
    const question = blank.length
      ? `Questions ${blank.join(', ')} are still blank. Blank answers count as wrong. Submit anyway? 还有空题，确定提交吗？`
      : 'Submit your answers? You can submit only once. 确定提交吗？只能提交一次。';
    if (!window.confirm(question)) return;
    const submissionId = newId('sub');
    submitButton.disabled = true;
    setStatus('Submitting…');
    try {
      clearTimeout(state.timer);
      await window.HanzhangAccess.post('submitOnline', { assignmentId: hw.assignmentId, saveId: state.saveId, resetVersion: state.resetVersion, submissionId, responses: state.responses });
      let submission = null;
      for (let attempt = 0; attempt < 10 && !submission; attempt += 1) {
        const data = await window.HanzhangAccess.request('getOnline', { assignmentId: hw.assignmentId, saveId: state.saveId });
        if (data.submission && data.submission.submissionId === submissionId) submission = data.submission;
        else if (data.submission) throw new Error('This homework was already submitted.');
        else await sleep(2000);
      }
      if (!submission) throw new Error('Your teacher has not received your answers yet. Please press Submit again.');
      state.submitted = submission;
      showSubmitted(submission);
      if (window.HanzhangHandIn) window.HanzhangHandIn.refresh();
    } catch (error) {
      setStatus((error && error.message) || 'Submitting did not finish. Please try again.');
      submitButton.disabled = false;
    }
  }

  function showSubmitted(submission) {
    if (submitButton) { submitButton.disabled = true; submitButton.hidden = true; }
    document.body.classList.add('hw-locked');
    items.forEach((item) => {
      item.querySelectorAll('.hw-choice').forEach((li) => { li.tabIndex = -1; });
      const box = item.querySelector('.hw-text');
      if (box) box.readOnly = true;
    });
    const when = new Date(submission.submittedAt);
    const stamp = isNaN(when) ? '' : when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (!submission.result) {
      setStatus(`Submitted ${stamp}`);
      if (resultEl) resultEl.innerHTML = '<p><b>Submitted.</b> 已提交。</p>';
      return;
    }
    const result = submission.result;
    setStatus(`Submitted ${stamp} · ${result.score} / ${result.autoTotal} correct`);
    result.items.forEach((row) => {
      const item = items.find((element) => element.dataset.n === String(row.n));
      if (!item) return;
      if (row.type === 'mc') {
        item.classList.add(row.isCorrect ? 'is-correct' : 'is-wrong');
        item.querySelectorAll('.hw-choice').forEach((li) => {
          li.classList.toggle('is-key', li.dataset.letter === row.key);
          li.classList.toggle('is-miss', li.dataset.letter === row.answer && !row.isCorrect);
        });
        const mark = document.createElement('p');
        mark.className = 'hw-mark';
        mark.innerHTML = row.isCorrect ? '<b>✓ Correct</b>' : `<b>✗ ${row.answer ? 'Your answer ' + esc(row.answer) : 'Blank'}</b> · Correct answer <b>${esc(row.key)}</b>`;
        item.querySelector('.choices').insertAdjacentElement('afterend', mark);
      } else {
        const mark = document.createElement('p');
        mark.className = 'hw-mark';
        mark.textContent = 'Answer received. 答案已收到。';
        (item.querySelector('.hw-text') || item.lastElementChild).insertAdjacentElement('afterend', mark);
      }
    });
    if (resultEl) {
      const open = result.openCount ? ` ${result.openCount} written answer${result.openCount === 1 ? '' : 's'} received.` : '';
      resultEl.innerHTML = `<p><b>${result.score} / ${result.autoTotal}</b> correct.${esc(open)} Wrong answers are marked above. 错题已标出。</p>`;
    }
  }
})();
