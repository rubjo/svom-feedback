const { BACKEND_URL } = window.FT_CONFIG;

// Maps a "status:*" label to a board column. Anything without one → triage.
const STATUS_COLUMNS = ['triage', 'planned', 'in-progress', 'done'];

// Norwegian display names for statuses (used in badges/detail).
const STATUS_LABELS = {
  triage: 'Til vurdering',
  planned: 'Planlagt',
  'in-progress': 'Under arbeid',
  done: 'Ferdig',
};

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

async function fetchIssueDetail(number) {
  const res = await fetch(`${BACKEND_URL}/api/issues/${number}`);
  if (!res.ok) throw new Error(`Backend /api/issues/${number} ${res.status}`);
  return res.json();
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
  const el = document.createElement('button');
  el.className = 'card';
  el.type = 'button';
  el.setAttribute('aria-label', `Åpne sak: ${issue.title}`);
  el.onclick = () => openDetail(issue.number);

  const chips = issue.labels
    .filter((l) => !isInternalLabel(l.name))
    .map((l) => `<span class="tag" style="--chip:#${l.color || '888'}">${escapeHtml(l.name)}</span>`)
    .join('');

  const commentWord = issue.comments === 1 ? 'kommentar' : 'kommentarer';
  el.innerHTML = `
    <div class="card-main">
      <h3>${escapeHtml(issue.title)}</h3>
      <div class="tags">${chips}</div>
      <div class="card-meta">#${issue.number} · ${issue.comments} ${commentWord}</div>
    </div>`;
  return el;
}

function render() {
  renderLabelChips();
  for (const col of STATUS_COLUMNS) {
    document.querySelector(`[data-col="${col}"]`).innerHTML = '';
  }
  const visible = state.issues.filter(matchesFilters);
  for (const issue of visible) {
    const col = document.querySelector(`[data-col="${statusOf(issue)}"]`);
    if (col) col.appendChild(card(issue));
  }
  document.getElementById('loadState').hidden = true;
}

function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Very small, safe formatter: escape, then turn line breaks into <br>.
function formatBody(s = '') {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// ── Detail modal ──────────────────────────────────────────────────────
async function openDetail(number) {
  const dlg = document.getElementById('detailDialog');
  const body = document.getElementById('detailBody');
  body.innerHTML = '<p class="load-state">Laster sak…</p>';
  dlg.showModal();
  try {
    const { issue, comments } = await fetchIssueDetail(number);
    const status = issue.state === 'closed' ? 'done' : statusOf(issue);
    const chips = issue.labels
      .filter((l) => !isInternalLabel(l.name))
      .map((l) => `<span class="tag" style="--chip:#${l.color || '888'}">${escapeHtml(l.name)}</span>`)
      .join('');

    const commentsHtml = comments.length
      ? comments
          .map(
            (c) => `
            <div class="comment">
              <div class="comment-head">
                ${c.author_avatar ? `<img class="avatar" src="${c.author_avatar}" alt="" />` : ''}
                <strong>${escapeHtml(c.author)}</strong>
                <span class="comment-date">${formatDate(c.created_at)}</span>
              </div>
              <div class="comment-body">${formatBody(c.body)}</div>
            </div>`
          )
          .join('')
      : '<p class="muted">Ingen oppdateringer ennå.</p>';

    body.innerHTML = `
      <div class="detail-head">
        <span class="badge badge-${status}">${STATUS_LABELS[status]}</span>
      </div>
      <h2 class="detail-title">${escapeHtml(issue.title)}</h2>
      <div class="tags">${chips}</div>
      <div class="detail-desc">${formatBody(issue.body || '')}</div>
      <h3 class="detail-sub">Oppdateringer</h3>
      <div class="comments">${commentsHtml}</div>
    `;
  } catch (err) {
    console.error(err);
    body.innerHTML = '<p class="muted">Kunne ikke laste saken. Prøv igjen senere.</p>';
  }
}

// ── Submissions (via Railway backend) ─────────────────────────────────
async function api(path, opts = {}) {
  return fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
}

function wireUI() {
  const fd = document.getElementById('feedbackDialog');

  document.getElementById('newBtn').onclick = () => fd.showModal();
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
    msg.textContent = 'Sender inn…';
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
      showFeedbackConfirmation(data);
      form.reset();
      setTimeout(load, 2000); // refresh the board so a new public item appears
    } else {
      msg.textContent = 'Noe gikk galt. Prøv igjen.';
    }
  });
}

// Replaces the form with a friendly confirmation. Copy differs by visibility,
// since private submissions are the ones that get a personal reply by email.
function showFeedbackConfirmation({ issue_number, visibility }) {
  const dialog = document.getElementById('feedbackDialog');
  const isPrivate = visibility === 'private';
  const message = isPrivate
    ? `Saken din er registrert som <strong>#${issue_number}</strong>. Vi tar kontakt på e-posten du oppga så snart vi kan.`
    : `Forslaget ditt er registrert som <strong>#${issue_number}</strong> og vises nå på veikartet. Der kan du følge med på status.`;

  dialog.innerHTML = `
    <div class="confirmation">
      <div class="confirmation-check" aria-hidden="true">✓</div>
      <h2>Takk for tilbakemeldingen!</h2>
      <p>${message}</p>
      <div class="dialog-actions">
        <button type="button" class="btn primary" id="confirmCloseBtn">Lukk</button>
      </div>
    </div>`;
  document.getElementById('confirmCloseBtn').onclick = () => location.reload();
}

// ── Boot ──────────────────────────────────────────────────────────────
async function load() {
  try {
    state.issues = await fetchIssues();
    render();
  } catch (err) {
    document.getElementById('loadState').textContent =
      'Kunne ikke laste tilbakemeldinger.';
    console.error(err);
  }
}

wireUI();
load();
