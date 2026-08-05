const { BACKEND_URL } = window.FT_CONFIG;

// Maps a "status:*" label to a board column. Anything without one → triage.
const STATUS_COLUMNS = ['triage', 'planned', 'in-progress', 'done'];

const state = {
  issues: [],
  activeLabels: new Set(),
  search: '',
  showClosed: false,
};

// ── Data ────────────────────────────────────────────────────────────────
// The issues repo is PRIVATE — reads are proxied through the Railway backend,
// which returns only public-visibility issues in a safe shape.
async function fetchIssues() {
  const res = await fetch(`${BACKEND_URL}/api/issues`);
  if (!res.ok) throw new Error(`Backend /api/issues ${res.status}`);
  const { issues } = await res.json();
  return issues;
}

function statusOf(issue) {
  const s = issue.labels
    .map((l) => l.name)
    .find((n) => n && n.startsWith('status:'));
  if (issue.state === 'closed') return 'done';
  if (!s) return 'triage';
  const key = s.replace('status:', '');
  return STATUS_COLUMNS.includes(key) ? key : 'triage';
}

function reactionCount(issue) {
  return (issue.reactions && issue.reactions.up) || 0;
}

// ── Rendering ─────────────────────────────────────────────────────────
// Internal labels the UI should never show as filter chips or tags.
function isInternalLabel(name) {
  return !name || name.startsWith('status:') || name.startsWith('visibility:');
}

function allLabels() {
  const set = new Map();
  for (const i of state.issues) {
    for (const l of i.labels) {
      if (!isInternalLabel(l.name)) set.set(l.name, l.color || '888');
    }
  }
  return [...set.entries()];
}

function renderLabelChips() {
  const box = document.getElementById('labelFilters');
  box.innerHTML = '';
  for (const [name, color] of allLabels()) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.activeLabels.has(name) ? ' active' : '');
    chip.textContent = name;
    chip.style.setProperty('--chip', `#${color}`);
    chip.onclick = () => {
      state.activeLabels.has(name)
        ? state.activeLabels.delete(name)
        : state.activeLabels.add(name);
      render();
    };
    box.appendChild(chip);
  }
}

function matchesFilters(issue) {
  if (!state.showClosed && issue.state === 'closed') return false;
  if (state.search) {
    const hay = (issue.title + ' ' + (issue.body || '')).toLowerCase();
    if (!hay.includes(state.search.toLowerCase())) return false;
  }
  if (state.activeLabels.size) {
    const names = issue.labels.map((l) => l.name);
    for (const want of state.activeLabels) {
      if (!names.includes(want)) return false;
    }
  }
  return true;
}

function card(issue) {
  const el = document.createElement('div');
  el.className = 'card';

  const votes = reactionCount(issue);
  const chips = issue.labels
    .filter((l) => !isInternalLabel(l.name))
    .map((l) => `<span class="tag" style="--chip:#${l.color || '888'}">${escapeHtml(l.name)}</span>`)
    .join('');

  el.innerHTML = `
    <div class="card-vote" title="Reactions">▲ ${votes}</div>
    <div class="card-main">
      <h3>${escapeHtml(issue.title)}</h3>
      <div class="tags">${chips}</div>
      <div class="card-meta">#${issue.number} · ${issue.comments} comments</div>
    </div>`;
  return el;
}

function render() {
  renderLabelChips();
  for (const col of STATUS_COLUMNS) {
    document.querySelector(`[data-col="${col}"]`).innerHTML = '';
  }
  const visible = state.issues.filter(matchesFilters);
  // Sort each column by reaction count desc so popular items surface.
  visible.sort((a, b) => reactionCount(b) - reactionCount(a));
  for (const issue of visible) {
    const col = document.querySelector(`[data-col="${statusOf(issue)}"]`);
    if (col) col.appendChild(card(issue));
  }
  document.getElementById('loadState').hidden = true;
}

function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Auth + submissions (via Railway backend) ──────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res;
}

async function refreshAuth() {
  try {
    const res = await api('/api/me');
    const signedIn = res.ok;
    const data = signedIn ? await res.json() : {};
    document.getElementById('signInBtn').hidden = signedIn;
    document.getElementById('signOutBtn').hidden = !signedIn;
    document.getElementById('myCasesBtn').hidden = !signedIn;
    const emailEl = document.getElementById('userEmail');
    emailEl.hidden = !signedIn;
    emailEl.textContent = data.email || '';
  } catch {
    /* backend not reachable; public board still works */
  }
}

function wireUI() {
  const fd = document.getElementById('feedbackDialog');
  const sd = document.getElementById('signInDialog');
  const cd = document.getElementById('casesDialog');

  document.getElementById('newBtn').onclick = () => fd.showModal();
  document.getElementById('signInBtn').onclick = () => sd.showModal();
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => b.closest('dialog').close();
  });

  document.getElementById('search').oninput = (e) => {
    state.search = e.target.value;
    render();
  };
  document.getElementById('showClosed').onchange = (e) => {
    state.showClosed = e.target.checked;
    render();
  };

  // Submit feedback
  document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById('feedbackMsg');
    msg.textContent = 'Submitting…';
    const payload = {
      type: form.type.value,
      title: form.title.value,
      body: form.body.value,
      email: form.email.value,
      visibility: form.visibility.value,
    };
    const res = await api('/api/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      const vis = data.visibility === 'private' ? ' (private)' : '';
      msg.textContent = `Thanks! Filed as #${data.issue_number}${vis}.`;
      form.reset();
      setTimeout(() => fd.close(), 1500);
      setTimeout(load, 2000);
    } else {
      msg.textContent = 'Something went wrong. Please try again.';
    }
  });

  // Request magic link
  document.getElementById('signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('signInMsg');
    msg.textContent = 'Sending…';
    const res = await api('/api/auth/request', {
      method: 'POST',
      body: JSON.stringify({ email: e.target.email.value }),
    });
    msg.textContent = res.ok
      ? 'Check your email for a sign-in link.'
      : 'Could not send link.';
  });

  // Sign out
  document.getElementById('signOutBtn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    refreshAuth();
  };

  // My cases
  document.getElementById('myCasesBtn').onclick = async () => {
    const list = document.getElementById('casesList');
    list.innerHTML = '<li>Loading…</li>';
    cd.showModal();
    const res = await api('/api/my-cases');
    if (!res.ok) {
      list.innerHTML = '<li>Please sign in again.</li>';
      return;
    }
    const { cases } = await res.json();
    list.innerHTML = cases.length
      ? cases
          .map(
            (c) =>
              `<li>
                 <div class="case-title">#${c.issue_number} — ${escapeHtml(c.title)}</div>
                 <div class="case-meta">
                   <span class="badge badge-${c.status}">${c.status.replace('-', ' ')}</span>
                   <span class="badge badge-vis">${c.visibility}</span>
                 </div>
               </li>`
          )
          .join('')
      : '<li>No cases yet.</li>';
  };
}

// ── Boot ──────────────────────────────────────────────────────────────
async function load() {
  try {
    state.issues = await fetchIssues();
    render();
  } catch (err) {
    document.getElementById('loadState').textContent =
      'Could not load feedback from GitHub.';
    console.error(err);
  }
}

function showAuthToast() {
  const p = new URLSearchParams(location.search).get('auth');
  if (p === 'ok') alert('Signed in! Click "My cases" to see your submissions.');
  if (p === 'invalid') alert('That sign-in link was invalid or expired.');
  if (p) history.replaceState({}, '', location.pathname);
}

wireUI();
showAuthToast();
refreshAuth();
load();
