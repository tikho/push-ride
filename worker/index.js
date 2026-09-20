/**
 * Push Ride scores Worker
 * POST /score  { initData, score }
 * GET  /leaderboard
 */

function dayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(),
  });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ),
    new TextEncoder().encode(botToken)
  );

  const calculated = await hmacHex(secretKey, dataCheckString);
  if (!timingSafeEqual(calculated, hash)) return null;

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (e) {
    return null;
  }
  if (!user || user.id == null) return null;
  return user;
}

function displayName(user) {
  if (!user) return 'Игрок';
  if (user.username) return user.username;
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Игрок';
}

async function handleScore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad_request' }, 400);
  }

  const initData = body && body.initData;
  const score = Number(body && body.score);
  if (!initData || !Number.isFinite(score) || score < 0 || score > 1e7) {
    return json({ error: 'bad_request' }, 400);
  }

  const user = await validateInitData(initData, env.BOT_TOKEN);
  if (!user) return json({ error: 'forbidden' }, 403);

  const day = dayKey();
  const key = `score:${day}:${user.id}`;
  const prevRaw = await env.SCORES.get(key);
  let prevScore = 0;
  if (prevRaw) {
    try {
      prevScore = Number(JSON.parse(prevRaw).score) || 0;
    } catch (e) {
      prevScore = 0;
    }
  }

  const best = Math.max(prevScore, Math.floor(score));
  const record = {
    userId: user.id,
    name: displayName(user),
    score: best,
    day,
  };
  await env.SCORES.put(key, JSON.stringify(record));

  return json({ ok: true, score: best, improved: best > prevScore });
}

async function handleLeaderboard(request, env) {
  const day = dayKey();
  const prefix = `score:${day}:`;
  const listed = await env.SCORES.list({ prefix, limit: 1000 });
  const rows = [];
  for (const item of listed.keys) {
    const raw = await env.SCORES.get(item.name);
    if (!raw) continue;
    try {
      const row = JSON.parse(raw);
      rows.push({
        userId: row.userId,
        name: row.name || 'Игрок',
        score: Number(row.score) || 0,
      });
    } catch (e) {}
  }

  rows.sort((a, b) => b.score - a.score || a.userId - b.userId);
  const top = rows.slice(0, 10).map((r, i) => ({
    place: i + 1,
    name: r.name,
    score: r.score,
    userId: r.userId,
  }));

  const url = new URL(request.url);
  let me = null;
  const initData = url.searchParams.get('initData');
  if (initData) {
    const user = await validateInitData(initData, env.BOT_TOKEN);
    if (user) {
      const idx = rows.findIndex((r) => String(r.userId) === String(user.id));
      if (idx >= 0) {
        me = {
          place: idx + 1,
          name: rows[idx].name,
          score: rows[idx].score,
          userId: rows[idx].userId,
        };
      } else {
        me = {
          place: null,
          name: displayName(user),
          score: 0,
          userId: user.id,
        };
      }
    }
  }

  return json({ day, top, me });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'POST' && (path === '/score' || path.endsWith('/score'))) {
      return handleScore(request, env);
    }
    if (request.method === 'GET' && (path === '/leaderboard' || path.endsWith('/leaderboard'))) {
      return handleLeaderboard(request, env);
    }

    return json({ error: 'not_found' }, 404);
  },
};
