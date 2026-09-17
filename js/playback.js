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

let beats = [];
let revealed = 0;
let playing = false;
let pendingTimer = null;

async function init() {
  beats = await fetch('data/content.json').then((r) => r.json());
  render(false);
  document.getElementById('btn-prev').addEventListener('click', stepBack);
  document.getElementById('btn-next').addEventListener('click', stepForward);
  document.getElementById('btn-play').addEventListener('click', togglePlay);
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

function createTaskCard(title) {
  const card = document.createElement('div');
  card.className = 'task-card';
  const h = document.createElement('h3');
  h.textContent = title;
  card.appendChild(h);
  return card;
}

function appendTaskSection(card, beat) {
  const row = document.createElement('div');
  row.className = 'task-section-row';

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
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = '❯';
    const body = document.createElement('span');
    body.className = 'body';
    line.appendChild(prefix);
    line.appendChild(body);
    container.appendChild(line);
    if (animate) {
      typeText(body, beat.text, onDone);
      return;
    }
    body.textContent = beat.text;
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
      setTimeout(() => {
        pulse.remove();
        line.appendChild(renderMarkdown(beat.text));
        setTimeout(onDone, 550);
      }, 450);
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
  const speed = Math.max(3, Math.min(30, 2000 / text.length));
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  el.parentElement.appendChild(cursor);
  function step() {
    i++;
    el.textContent = text.slice(0, i);
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
  const seen = new Map();
  for (let i = 0; i < revealed; i++) {
    const docs = beats[i].docsAdded;
    if (docs) docs.forEach((d) => seen.set(d.path, d.label));
  }
  list.innerHTML = '';
  if (seen.size === 0) {
    list.innerHTML = '<li class="docs-empty">Nothing yet</li>';
    return;
  }
  for (const [path, label] of seen) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `doc.html?file=${encodeURIComponent(path)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = label;
    const pathEl = document.createElement('div');
    pathEl.className = 'doc-path';
    pathEl.textContent = path;
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
      appendTaskSection(currentCard, beat);
      if (isNewest && animateNewest) {
        pendingTimer = setTimeout(advanceIfPlaying, 300);
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
  body.scrollTop = body.scrollHeight;
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
