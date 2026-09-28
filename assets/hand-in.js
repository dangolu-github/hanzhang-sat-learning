// Hand-in panel for one homework: status, (1) answer online, (2) upload photos or a PDF, (3) sent on WeChat.
// Markup: <div class="hz-handin" data-assignment="id" data-online="page/#answer" data-here="1"></div>
(() => {
  const MAX_FILES = 20;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const COMPRESS_OVER = 1.2 * 1024 * 1024;
  const panels = Array.from(document.querySelectorAll('.hz-handin[data-assignment]'));
  if (!panels.length) return;

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const newId = (prefix) => prefix + '-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(16) + Math.random().toString(16).slice(2));
  const when = (value) => {
    const d = new Date(value);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const size = (bytes) => bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  panels.forEach(render);
  refreshAll();
  window.HanzhangHandIn = { refresh: refreshAll };

  function render(panel) {
    const id = panel.dataset.assignment;
    const here = panel.dataset.here === '1';
    const online = panel.dataset.online || '';
    const onlineBody = !online
      ? '<p class="hz-note">This homework is done on paper. Hand it in with option 2 or 3. 这份作业在纸上完成，用第2或第3种方式提交。</p>'
      : here
        ? '<p class="hz-note">Choose or type your answers on this page, then press <b>Submit answers</b> at the bottom. 在本页作答，最后点 Submit answers。</p><a class="hz-btn" href="#answer">Go to answer boxes<small>打开答案输入区</small></a>'
        : `<a class="hz-btn" href="${esc(online)}">Answer online<small>打开网页版作答</small></a>`;
    panel.innerHTML = `
      <h4>Hand in 提交作业</h4>
      <p class="hz-note"><strong>Choose ONE method only. 提交方式任选一种即可，无需重复提交。</strong></p>
      <ul class="hz-status" aria-live="polite"><li class="hz-note">Checking what you have handed in…</li></ul>
      <div class="hz-options">
        <details class="hz-option" data-option="online"${here ? ' open' : ''}>
          <summary><span class="n">1</span><span>Answer online <small>网页作答 · 选择题自动批改，文字题老师批改</small></span></summary>
          <div class="hz-option-body">${onlineBody}</div>
        </details>
        <details class="hz-option" data-option="upload">
          <summary><span class="n">2</span><span>Upload photos or a PDF <small>上传照片或 PDF</small></span></summary>
          <div class="hz-option-body">
            <label class="hz-drop">
              <input type="file" multiple accept="image/*,application/pdf,.pdf,.heic,.heif">
              <strong>Choose photos or a PDF</strong>
              <span>Take a clear photo of each page. 每页拍一张清楚的照片。</span>
            </label>
            <ul class="hz-files"></ul>
            <label class="hz-field">Note to your teacher (optional) 留言（可选）<textarea data-note="upload" maxlength="500"></textarea></label>
            <div class="hz-actions"><button class="hz-btn" type="button" data-action="upload" disabled>Upload<small>上传</small></button></div>
            <div class="hz-progress" hidden><i></i></div>
            <p class="hz-msg" data-msg="upload" role="status"></p>
          </div>
        </details>
        <details class="hz-option" data-option="wechat">
          <summary><span class="n">3</span><span>I sent it on WeChat <small>已通过微信发给老师</small></span></summary>
          <div class="hz-option-body">
            <p class="hz-note">Send the photos to your teacher on WeChat first, then press the button so she knows to check them. 先在微信发照片，再点按钮。</p>
            <label class="hz-field">Note to your teacher (optional) 留言（可选）<textarea data-note="wechat" maxlength="500"></textarea></label>
            <div class="hz-actions"><button class="hz-btn" type="button" data-action="wechat">I sent it on WeChat<small>我已微信发送</small></button></div>
            <p class="hz-msg" data-msg="wechat" role="status"></p>
          </div>
        </details>
      </div>`;

    const input = panel.querySelector('input[type=file]');
    const drop = panel.querySelector('.hz-drop');
    const uploadButton = panel.querySelector('[data-action=upload]');
    input.addEventListener('change', () => showFiles(panel));
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragging');
      if (event.dataTransfer && event.dataTransfer.files.length) { input.files = event.dataTransfer.files; showFiles(panel); }
    });
    uploadButton.addEventListener('click', () => upload(panel, id));
    panel.querySelector('[data-action=wechat]').addEventListener('click', () => wechat(panel, id));
  }

  function message(panel, which, text, kind) {
    const el = panel.querySelector(`[data-msg=${which}]`);
    el.textContent = text;
    el.className = 'hz-msg' + (kind ? ' ' + kind : '');
  }

  function checkFiles(files) {
    if (!files.length) return 'Choose at least one photo or PDF.';
    if (files.length > MAX_FILES) return `Choose no more than ${MAX_FILES} files at one time.`;
    const bad = files.find((file) => !/^image\//.test(file.type) && file.type !== 'application/pdf' && !/\.(pdf|heic|heif|jpe?g|png|webp)$/i.test(file.name));
    if (bad) return `${bad.name} is not a photo or PDF.`;
    return '';
  }

  function showFiles(panel) {
    const files = Array.from(panel.querySelector('input[type=file]').files || []);
    panel.querySelector('.hz-files').innerHTML = files.map((file) => `<li><span>${esc(file.name)}</span><span>${size(file.size)}</span></li>`).join('');
    const problem = files.length ? checkFiles(files) : '';
    message(panel, 'upload', problem || (files.length ? `${files.length} file${files.length === 1 ? '' : 's'} ready.` : ''), problem ? 'error' : '');
    panel.querySelector('[data-action=upload]').disabled = !files.length || Boolean(problem);
  }

  // Phone photos are large; shrink them to a sharp, readable JPEG before sending.
  async function prepare(file) {
    const isImage = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (isImage && file.size > COMPRESS_OVER) {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        if (blob && blob.size < file.size) return { blob, type: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
      } catch (error) { /* keep the original file */ }
    }
    let type = file.type;
    if (!type) type = /\.pdf$/i.test(file.name) ? 'application/pdf' : /\.hei[cf]$/i.test(file.name) ? 'image/heic' : 'image/jpeg';
    return { blob: file, type, name: file.name };
  }

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  async function upload(panel, assignmentId) {
    const input = panel.querySelector('input[type=file]');
    const files = Array.from(input.files || []);
    const problem = checkFiles(files);
    if (problem) { message(panel, 'upload', problem, 'error'); return; }
    const button = panel.querySelector('[data-action=upload]');
    const bar = panel.querySelector('.hz-progress');
    const fill = bar.querySelector('i');
    const note = panel.querySelector('[data-note=upload]').value.trim();
    const batchId = newId('batch');
    button.disabled = true;
    bar.hidden = false;
    fill.style.width = '0%';
    try {
      await window.HanzhangAccess.ensureFreshAccess(false);
      for (let i = 0; i < files.length; i += 1) {
        message(panel, 'upload', `Sending ${i + 1} of ${files.length}… Keep this page open. 正在上传，请不要关闭页面。`, '');
        const ready = await prepare(files[i]);
        if (ready.blob.size > MAX_FILE_BYTES) throw new Error(`${files[i].name} is larger than 12 MB. Take the photo again at a smaller size.`);
        await window.HanzhangAccess.post('uploadFile', {
          assignmentId, batchId, fileId: newId('file'), index: i + 1, total: files.length,
          name: ready.name, type: ready.type, size: ready.blob.size, note, data: await toBase64(ready.blob)
        });
        fill.style.width = Math.round(((i + 1) / files.length) * 90) + '%';
      }
      message(panel, 'upload', 'Checking that your teacher received every file…', '');
      let received = 0;
      for (let attempt = 0; attempt < 12 && received < files.length; attempt += 1) {
        const status = await window.HanzhangAccess.request('getUploadBatch', { assignmentId, batchId });
        received = Number(status.received || 0);
        if (received < files.length) await sleep(2500);
      }
      if (received < files.length) throw new Error(`Only ${received} of ${files.length} files arrived. Please upload the missing pages again.`);
      fill.style.width = '100%';
      input.value = '';
      panel.querySelector('.hz-files').innerHTML = '';
      panel.querySelector('[data-note=upload]').value = '';
      message(panel, 'upload', `Uploaded ${received} file${received === 1 ? '' : 's'}. Your teacher will check your work. 上传成功。`, 'success');
      refreshAll();
    } catch (error) {
      message(panel, 'upload', (error && error.message) || 'The upload did not finish. Please try again.', 'error');
      button.disabled = false;
    } finally {
      setTimeout(() => { bar.hidden = true; }, 1200);
    }
  }

  async function wechat(panel, assignmentId) {
    if (!window.confirm('Did you already send your homework photos to your teacher on WeChat? 你已经在微信上发给老师了吗？')) return;
    const button = panel.querySelector('[data-action=wechat]');
    const note = panel.querySelector('[data-note=wechat]').value.trim();
    const eventId = newId('wechat');
    button.disabled = true;
    message(panel, 'wechat', 'Letting your teacher know…', '');
    try {
      await window.HanzhangAccess.post('wechatHandIn', { assignmentId, eventId, note });
      let found = false;
      for (let attempt = 0; attempt < 8 && !found; attempt += 1) {
        const data = await window.HanzhangAccess.request('getHandIn', { assignmentIds: assignmentId });
        const status = (data.assignments || [])[0] || {};
        found = (status.wechat || []).some((event) => event.eventId === eventId);
        if (!found) await sleep(2000);
        else paint(status);
      }
      if (!found) throw new Error('Your teacher did not get the message yet. Please press the button again.');
      panel.querySelector('[data-note=wechat]').value = '';
      message(panel, 'wechat', 'Done. Your teacher will check the photos you sent on WeChat. 已通知老师。', 'success');
    } catch (error) {
      message(panel, 'wechat', (error && error.message) || 'Please try again.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function refreshAll() {
    const ids = panels.map((panel) => panel.dataset.assignment);
    try {
      await window.HanzhangAccess.ready;
      const data = await window.HanzhangAccess.request('getHandIn', { assignmentIds: ids.join(',') });
      (data.assignments || []).forEach(paint);
    } catch (error) {
      panels.forEach((panel) => {
        panel.querySelector('.hz-status').innerHTML = `<li class="hz-note">${esc((error && error.message) || 'Could not load your hand-in status.')}</li>`;
      });
    }
  }

  function paint(status) {
    const panel = panels.find((item) => item.dataset.assignment === status.assignmentId);
    if (!panel) return;
    const rows = [];
    const online = status.online || {};
    if (online.available) {
      if (online.state === 'submitted') {
        const score = online.showResult && online.autoTotal ? ` · ${online.score} / ${online.autoTotal} correct` : '';
        rows.push(`<li><span class="hz-pill good">Online answers submitted</span><span>${esc(when(online.submittedAt))}${esc(score)}</span></li>`);
      } else if (online.state === 'draft') {
        rows.push(`<li><span class="hz-pill warn">Online answers saved</span><span>${online.answered} / ${online.total} answered · not submitted yet</span></li>`);
      }
    }
    (status.uploads || []).forEach((batch) => rows.push(`<li><span class="hz-pill good">Uploaded</span><span>${batch.files} file${batch.files === 1 ? '' : 's'} · ${esc(when(batch.at))}</span></li>`));
    (status.wechat || []).forEach((event) => rows.push(`<li><span class="hz-pill good">Sent on WeChat</span><span>${esc(when(event.at))}</span></li>`));
    if (!rows.length) rows.push('<li class="hz-note">Nothing handed in yet. 还没有提交。</li>');
    else if (status.review === 'checked') rows.push(`<li><span class="hz-pill good">Checked by your teacher</span><span>${esc(when(status.reviewedAt))}</span></li>`);
    else if (status.review === 'waiting') rows.push('<li><span class="hz-pill">Waiting for your teacher to check</span></li>');
    if (status.receiving === false) rows.push('<li class="hz-note">Hand-in is closed for this homework. 本作业已停止提交。</li>');
    panel.querySelector('.hz-status').innerHTML = rows.join('');
    if (status.receiving === false) panel.querySelectorAll('[data-action]').forEach((button) => { button.disabled = true; });
  }
})();
