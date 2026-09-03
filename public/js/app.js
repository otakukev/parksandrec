let me = null;
let knownUsers = []; // for @mention highlighting and admin table

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderContentWithMentions(content) {
  const escaped = escapeHtml(content);
  return escaped.replace(/@([a-z0-9_.]+)/gi, (full, uname) => {
    const known = knownUsers.some((u) => u.username === uname.toLowerCase());
    return known ? `<span class="mention">@${uname}</span>` : full;
  });
}

function timeLabel(iso) {
  const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------- bootstrap ----------
async function bootstrap() {
  const meRes = await fetch('/api/auth/me');
  const meData = await meRes.json();
  if (!meData.user) {
    window.location.href = '/login.html';
    return;
  }
  me = meData.user;

  document.getElementById('who-name').textContent = me.displayName;
  document.getElementById('who-role').textContent = me.role;

  if (me.role === 'admin' || me.role === 'manager') {
    document.getElementById('board-composer-wrap').hidden = false;
  }
  if (me.role === 'admin') {
    document.getElementById('admin-tab-btn').hidden = false;
  }

  const usersRes = await fetch('/api/users');
  const usersData = await usersRes.json();
  knownUsers = usersData.users || [];

  setupTabs();
  setupLogout();
  setupChat();
  setupBoard();
  if (me.role === 'admin') setupAdmin();

  await loadHistory();
  await loadBoard();
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

// ---------- chat ----------
// No WebSocket here: Netlify Functions can't hold a persistent connection,
// so "live" means polling the server every couple seconds. Everything still
// goes through our normal session-cookie auth on every request.
const POLL_INTERVAL_MS = 2000;
const TYPING_DEBOUNCE_MS = 1500;

let lastMessageId = 0;
let typingSendTimeout;
let isCurrentlyTyping = false;
let pollTimer;

function appendMessage(msg) {
  const wrap = document.getElementById('messages');
  const div = document.createElement('div');
  const mine = msg.author.id === me.id;
  const mentionsMe = (msg.mentions || []).includes(me.username);
  div.className = `message${mine ? ' mine' : ''}${mentionsMe ? ' mentions-me' : ''}`;
  div.innerHTML = `
    <div class="meta">${escapeHtml(msg.author.displayName)}<span class="role-tag">${escapeHtml(msg.author.role)}</span> · ${timeLabel(msg.createdAt)}</div>
    <div class="bubble">${renderContentWithMentions(msg.content)}</div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  if (msg.id > lastMessageId) lastMessageId = msg.id;
}

async function loadHistory() {
  const res = await fetch('/api/messages?channel=general&limit=100');
  const data = await res.json();
  document.getElementById('messages').innerHTML = '';
  lastMessageId = 0;
  (data.messages || []).forEach(appendMessage);
}

function renderOnline(online) {
  const list = document.getElementById('online-list');
  list.innerHTML = '';
  online
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .forEach((u) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot"></span>${escapeHtml(u.displayName)}${u.id === me.id ? ' (you)' : ''}`;
      list.appendChild(li);
    });
}

function renderTyping(typingUsers) {
  const el = document.getElementById('typing-indicator');
  const names = typingUsers.map((u) => u.displayName);
  if (names.length === 0) {
    el.textContent = '';
  } else if (names.length === 1) {
    el.textContent = `${names[0]} is typing…`;
  } else {
    el.textContent = `${names.join(', ')} are typing…`;
  }
}

async function poll() {
  try {
    const res = await fetch(`/api/chat/poll?afterId=${lastMessageId}`);
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const data = await res.json();
    (data.messages || []).forEach(appendMessage);
    renderTyping(data.typingUsers || []);
    renderOnline(data.online || []);
  } catch (err) {
    // Transient network hiccup — just try again on the next tick.
  }
}

async function sendTyping(isTyping) {
  if (isTyping === isCurrentlyTyping) return;
  isCurrentlyTyping = isTyping;
  try {
    await fetch('/api/chat/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping }),
    });
  } catch (err) {
    // Best-effort; the next poll cycle will still work either way.
  }
}

function setupChat() {
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  poll();

  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');

  input.addEventListener('input', () => {
    sendTyping(true);
    clearTimeout(typingSendTimeout);
    typingSendTimeout = setTimeout(() => sendTyping(false), TYPING_DEBOUNCE_MS);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    clearTimeout(typingSendTimeout);
    isCurrentlyTyping = false; // sending a message implies typing has stopped server-side

    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not send message.');
      return;
    }
    appendMessage(data.message);
  });
}

// ---------- board ----------
function renderBoardPost(post) {
  const canDelete = me.role === 'admin' || (me.role === 'manager' && post.author.id === me.id);
  const div = document.createElement('div');
  div.className = 'board-post';
  div.innerHTML = `
    <h3>${escapeHtml(post.title)}</h3>
    <div class="meta">${escapeHtml(post.author.displayName)} <span class="role-tag">${escapeHtml(post.author.role)}</span> · ${timeLabel(post.createdAt)}</div>
    <div class="content">${escapeHtml(post.content)}</div>
    ${canDelete ? `<button class="delete-btn" data-id="${post.id}">Delete</button>` : ''}
  `;
  if (canDelete) {
    div.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!confirm('Delete this announcement?')) return;
      await fetch(`/api/board/${post.id}`, { method: 'DELETE' });
      await loadBoard();
    });
  }
  return div;
}

async function loadBoard() {
  const res = await fetch('/api/board');
  const data = await res.json();
  const wrap = document.getElementById('board-posts');
  wrap.innerHTML = '';
  if (!data.posts || data.posts.length === 0) {
    wrap.innerHTML = '<p class="empty-state">No announcements yet.</p>';
    return;
  }
  data.posts.forEach((post) => wrap.appendChild(renderBoardPost(post)));
}

function setupBoard() {
  const form = document.getElementById('board-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('board-title').value.trim();
    const content = document.getElementById('board-content').value.trim();
    if (!title || !content) return;
    const res = await fetch('/api/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (res.ok) {
      document.getElementById('board-title').value = '';
      document.getElementById('board-content').value = '';
      await loadBoard();
    } else {
      const data = await res.json();
      alert(data.error || 'Could not post announcement.');
    }
  });
}

// ---------- admin ----------
async function loadUserTable() {
  const res = await fetch('/api/users');
  const data = await res.json();
  knownUsers = data.users || [];
  const body = document.getElementById('user-table-body');
  body.innerHTML = '';
  knownUsers.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(u.displayName)}</td>
      <td>@${escapeHtml(u.username)}</td>
      <td>
        <select data-id="${u.id}">
          <option value="worker" ${u.role === 'worker' ? 'selected' : ''}>Worker</option>
          <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td></td>
    `;
    tr.querySelector('select').addEventListener('change', async (e) => {
      const role = e.target.value;
      const res = await fetch(`/api/users/${u.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Could not update role.');
        await loadUserTable();
      }
    });
    body.appendChild(tr);
  });
}

function setupAdmin() {
  const form = document.getElementById('create-user-form');
  const errorEl = document.getElementById('admin-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const username = document.getElementById('new-username').value.trim();
    const displayName = document.getElementById('new-displayname').value.trim();
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Could not create user.';
      errorEl.hidden = false;
      return;
    }
    form.reset();
    await loadUserTable();
  });

  loadUserTable();
}

bootstrap();
