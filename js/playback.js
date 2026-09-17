const KIND_ICON = {
  implementation: '🔨',
  'spec-review': '📋',
  'code-review': '🔍',
  fix: '🔧',
};

const KIND_LABEL = {
  implementation: 'implementation',
  'spec-review': 'spec review',
  'code-review': 'code review',
  fix: 'fix',
};

let files = [];
let beats = [];
let revealed = 0;
let playing = false;
let pendingTimer = null;

async function init() {
  const startButton = document.getElementById('btn-start');
  startButton.addEventListener('click', startPlayback);
  const data = await fetch('data/content.json', { cache: 'no-store' }).then((r) => r.json());
  files = data.files;
  beats = data.beats;
  render(false);
  startButton.disabled = false;
  document.getElementById('btn-prev').addEventListener('click', stepBack);
  document.getElementById('btn-next').addEventListener('click', stepForward);
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-end').addEventListener('click', jumpToEnd);
}

function startPlayback() {
  if (!beats.length || playing) return;

  document.getElementById('btn-start').disabled = true;
  const intro = document.getElementById('intro-screen');
  const playback = document.getElementById('playback');
  playback.hidden = false;
  requestAnimationFrame(() => playback.classList.add('is-visible'));
  intro.classList.add('is-leaving');
  setTimeout(() => { intro.hidden = true; }, 320);

  setPlaying(true);
  advanceIfPlaying();
}

function scrollToBottom() {
  const body = document.getElementById('terminal-body');
  body.scrollTop = body.scrollHeight;
}

function verdictClass(verdict) {
  if (!verdict) return 'v-pending';
  if (verdict.includes('pass') || verdict.includes('done') || verdict.includes('fix applied')) return 'v-pass';
  if (verdict.includes('issue')) return 'v-fail';
  return 'v-pending';
}

function renderMarkdown(text) {
  const html = marked.parse(text);
  const el = document.createElement('div');
  el.className = 'body';
  el.innerHTML = html;
  el.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  return el;
}

function renderBlockHtml(token) {
  const el = document.createElement('div');
  el.className = 'body';
  el.innerHTML = marked.parser([token]);
  el.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  return el;
}

function revealBlocks(line, text, onDone) {
  const tokens = marked.lexer(text).filter((t) => t.type !== 'space');
  let idx = 0;
  function next() {
    if (idx >= tokens.length) {
      onDone();
      return;
    }
    line.appendChild(renderBlockHtml(tokens[idx++]));
    scrollToBottom();
    pendingTimer = setTimeout(next, 2000);
  }
  next();
}

function createTaskCard(title) {
  const card = document.createElement('div');
  card.className = 'task-card';
  const h = document.createElement('h3');
  h.textContent = title;
  card.appendChild(h);
  return card;
}

function appendTaskSection(card, beat, animate) {
  const row = document.createElement('div');
  row.className = 'task-section-row';
  if (animate) row.classList.add('is-new');

  const icon = document.createElement('span');
  icon.className = 'kind-icon';
  icon.textContent = KIND_ICON[beat.kind] || '•';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'kind-label';
  label.textContent = beat.round ? `${KIND_LABEL[beat.kind]} (round ${beat.round})` : KIND_LABEL[beat.kind];
  row.appendChild(label);

  const summary = document.createElement('span');
  summary.className = 'summary';
  summary.textContent = beat.summary;
  row.appendChild(summary);

  const verdict = document.createElement('span');
  verdict.className = `verdict ${verdictClass(beat.verdict)}`;
  verdict.textContent = beat.verdict;
  row.appendChild(verdict);

  card.appendChild(row);
}

function appendMessageBeat(container, beat, animate, onDone) {
  const line = document.createElement('div');
  line.className = `line ${beat.type}`;

  if (beat.type === 'user') {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'you';
    line.appendChild(label);
    container.appendChild(line);
    if (animate) {
      const pulse = document.createElement('div');
      pulse.className = 'responding';
      pulse.textContent = 'Ross is thinking…';
      line.appendChild(pulse);
      pendingTimer = setTimeout(() => {
        pulse.remove();
        const row = document.createElement('div');
        const prefix = document.createElement('span');
        prefix.className = 'prefix';
        prefix.textContent = '❯';
        const body = document.createElement('span');
        body.className = 'body';
        row.appendChild(prefix);
        row.appendChild(body);
        line.appendChild(row);
        typeText(body, beat.text, onDone);
      }, 2000);
      return;
    }
    const row = document.createElement('div');
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = '❯';
    const body = document.createElement('span');
    body.className = 'body';
    body.textContent = beat.text;
    row.appendChild(prefix);
    row.appendChild(body);
    line.appendChild(row);
  } else if (beat.type === 'assistant') {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'claude';
    line.appendChild(label);
    container.appendChild(line);
    if (animate) {
      const pulse = document.createElement('div');
      pulse.className = 'responding';
      pulse.textContent = 'responding…';
      line.appendChild(pulse);
      pendingTimer = setTimeout(() => {
        pulse.remove();
        revealBlocks(line, beat.text, onDone);
      }, 2200);
      return;
    }
    line.appendChild(renderMarkdown(beat.text));
  } else if (beat.type === 'activity') {
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = '·';
    const body = document.createElement('span');
    body.textContent = beat.text;
    line.appendChild(prefix);
    line.appendChild(body);
    container.appendChild(line);
  }

  if (animate && onDone) setTimeout(onDone, 350);
}

function typeText(el, text, onDone) {
  const speed = 32;
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  el.parentElement.appendChild(cursor);
  function step() {
    i++;
    el.textContent = text.slice(0, i);
    scrollToBottom();
    if (i < text.length) {
      pendingTimer = setTimeout(step, speed);
    } else {
      cursor.remove();
      setTimeout(onDone, 400);
    }
  }
  step();
}

function renderDocsPanel() {
  const list = document.getElementById('docs-list');
  const createdPaths = new Set();
  for (let i = 0; i < revealed; i++) {
    const paths = beats[i].docsRevealed;
    if (paths) paths.forEach((p) => createdPaths.add(p));
  }
  list.innerHTML = '';
  for (const file of files) {
    const created = createdPaths.has(file.path);
    const li = document.createElement('li');
    li.className = created ? 'doc-created' : 'doc-pending';
    const link = document.createElement('a');
    link.href = `doc.html?file=${encodeURIComponent(file.path)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = file.label;
    const pathEl = document.createElement('div');
    pathEl.className = 'doc-path';
    pathEl.textContent = created ? file.path : `${file.path} (not written yet)`;
    li.appendChild(link);
    li.appendChild(pathEl);
    list.appendChild(li);
  }
}

function updateProgress() {
  document.getElementById('progress').textContent = `${revealed} / ${beats.length}`;
  document.getElementById('btn-next').disabled = revealed >= beats.length;
  document.getElementById('btn-prev').disabled = revealed <= 0;
}

function render(animateNewest) {
  const body = document.getElementById('terminal-body');
  body.innerHTML = '';
  let currentCard = null;
  let currentTitle = null;

  for (let i = 0; i < revealed; i++) {
    const beat = beats[i];
    const isNewest = i === revealed - 1;

    if (beat.type === 'task-section') {
      if (beat.task !== currentTitle) {
        currentCard = createTaskCard(beat.task);
        body.appendChild(currentCard);
        currentTitle = beat.task;
      }
      appendTaskSection(currentCard, beat, isNewest && animateNewest);
      if (isNewest && animateNewest) {
        pendingTimer = setTimeout(advanceIfPlaying, 2400);
      }
    } else {
      currentCard = null;
      currentTitle = null;
      if (isNewest && animateNewest) {
        appendMessageBeat(body, beat, true, advanceIfPlaying);
      } else {
        appendMessageBeat(body, beat, false);
      }
    }
  }

  renderDocsPanel();
  updateProgress();
  scrollToBottom();
}

function advanceIfPlaying() {
  if (!playing) return;
  if (revealed >= beats.length) {
    setPlaying(false);
    return;
  }
  revealed++;
  render(true);
}

function stepForward() {
  if (playing) setPlaying(false);
  if (revealed >= beats.length) return;
  revealed++;
  render(false);
}

function jumpToEnd() {
  if (playing) setPlaying(false);
  revealed = beats.length;
  render(false);
}

function stepBack() {
  if (playing) setPlaying(false);
  if (revealed <= 0) return;
  revealed--;
  render(false);
}

function setPlaying(value) {
  playing = value;
  document.getElementById('btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
  if (!playing && pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

function togglePlay() {
  if (playing) {
    setPlaying(false);
    return;
  }
  if (revealed >= beats.length) {
    revealed = 0;
    render(false);
  }
  setPlaying(true);
  advanceIfPlaying();
}

init();
