const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Isolated regressions: no real LINE, browser session, messages or database.
function authHarness(post, remember = async () => {}) {
  let now = Date.parse('2026-10-19T00:00:00Z');
  class Clock extends Date { static now() { return now; } }
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middleware/lineAuth.js'), 'utf8'), {
    module: mod, exports: mod.exports, Date: Clock, URLSearchParams,
    require(name) {
      if (name === 'axios') return { post };
      if (name === '../config') return { lineLoginChannelId: 'TEST_CHANNEL' };
      if (name === '../utils/lineRecipient') return { rememberLineRecipient: remember };
      throw new Error('Unexpected dependency');
    },
  });
  return { auth: mod.exports, advance(ms) { now += ms; }, now: () => now };
}
const user = 'U' + 'a'.repeat(32);
async function middlewareResult(auth) {
  const result = {};
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; } };
  await auth.requireLineUser({ headers: { authorization: 'Bearer TEST_TOKEN' } }, res, () => { result.next = true; });
  return result;
}

test('cached authentication never extends a token beyond its real expiration', async () => {
  let calls = 0;
  const h = authHarness(async () => { calls++; return { data: { sub: user, exp: expiry } }; });
  const expiry = h.now() / 1000 + 2;
  await h.auth.verifyLineIdToken('TEST_TOKEN');
  h.advance(1000);
  await h.auth.verifyLineIdToken('TEST_TOKEN');
  assert.equal(calls, 1);
  h.advance(1001);
  await assert.rejects(h.auth.verifyLineIdToken('TEST_TOKEN'), { code: 'LINE_AUTH_REQUIRED' });
  assert.equal(calls, 2);
});

test('missing or invalid expiration is rejected even when provider returns a valid user id', async () => {
  for (const exp of [undefined, null, 'invalid', 0]) {
    const h = authHarness(async () => ({ data: { sub: user, exp } }));
    await assert.rejects(h.auth.verifyLineIdToken('TEST_TOKEN'), { code: 'LINE_AUTH_REQUIRED' });
  }
});

test('provider outage returns 503 instead of falsely asking the user to authenticate', async () => {
  for (const status of [429, 500, undefined]) {
    const h = authHarness(async () => { throw { message: 'TEST_SECRET', response: { status } }; });
    const result = await middlewareResult(h.auth);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'LINE_AUTH_UNAVAILABLE');
    assert.ok(!JSON.stringify(result).includes('TEST_SECRET'));
  }
  const h = authHarness(async () => { throw { response: { status: 400 } }; });
  assert.equal((await middlewareResult(h.auth)).status, 401);
});

test('profile persistence failure returns 503 and never authenticates an unavailable database', async () => {
  const h = authHarness(async () => ({ data: { sub: user, exp: h.now() / 1000 + 60 } }), async () => { throw new Error('TEST_SECRET'); });
  const result = await middlewareResult(h.auth);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'LINE_PROFILE_UNAVAILABLE');
  assert.equal(result.next, undefined);
  assert.ok(!JSON.stringify(result).includes('TEST_SECRET'));
});

function uiHarness(fetch) {
  const nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) {
      const classes = new Set(['hidden']);
      nodes.set(id, { dataset: {}, textContent: '', controls: [{ disabled: false }], events: {},
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
        addEventListener(name, handler) { this.events[name] = handler; }, querySelectorAll() { return this.controls; } });
    }
    return nodes.get(id);
  }
  const context = vm.createContext({
    document: { querySelector: element,
      querySelectorAll: s => s === '#appointmentForm,#todoForm,#preferenceForm' ?
        ['#appointmentForm', '#todoForm', '#preferenceForm'].map(element) : [], addEventListener() {} },
    window: { addEventListener() {}, liff: {} },
    fetch, URL, Date, Intl, location: { href: 'https://app.example/liff/calendar', reload() {} },
    setTimeout: () => 1, clearTimeout() {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  vm.runInContext(source.replace('initialize().catch(err=>showError(err.message));', ''), context);
  return { context, element, run: code => vm.runInContext(code, context) };
}

test('before authentication the UI blocks saving and presents a login action', async () => {
  const h = uiHarness(() => { throw new Error('Unexpected network'); });
  await h.run("saveForm($('#todoForm'),()=>{throw new Error('Must not save')},()=>{},'saved')");
  assert.equal(h.element('#todoForm').controls[0].disabled, true);
  assert.equal(h.element('#lineLoginButton').classList.contains('hidden'), false);
  assert.match(h.element('#systemBanner').textContent, /LINE/);
});

test('explicit login action uses the LINE SDK and never retries the pending write', () => {
  const h = uiHarness(() => { throw new Error('Must not write'); });
  const calls = [];
  h.context.window.liff = h.context.liff = {
    isInClient: () => false, isLoggedIn: () => true,
    logout: () => calls.push('logout'), login: options => calls.push(options.redirectUri),
  };
  h.element('#lineLoginButton').events.click();
  assert.deepEqual(calls, ['logout', 'https://app.example/liff/calendar']);
});

test('401 clears authentication and never automatically replays a write request', async () => {
  let calls = 0;
  const h = uiHarness(async () => { calls++; return { status: 401, ok: false, json: async () => ({}) }; });
  h.run("state.token='TEST_TOKEN';setAuthenticated(true)");
  await assert.rejects(h.run("api('/todos',{method:'POST',body:'{}'})"));
  assert.equal(calls, 1);
  assert.equal(h.run('state.token'), '');
  assert.equal(h.run('state.authenticated'), false);
  assert.equal(h.element('#todoForm').controls[0].disabled, true);
});

test('a successful save followed by refresh failure stays successful and double submit is blocked', async () => {
  const h = uiHarness(async () => ({ status: 503, ok: false, json: async () => ({ error: 'TEST_OFFLINE' }) }));
  h.run("state.token='TEST_TOKEN';setAuthenticated(true)");
  let calls = 0, resets = 0, release;
  h.context.save = async () => { calls++; await new Promise(resolve => { release = resolve; }); };
  h.context.reset = () => { resets++; };
  const first = h.run("saveForm($('#todoForm'),save,reset,'เพิ่ม To-do แล้ว')");
  await h.run("saveForm($('#todoForm'),save,reset,'เพิ่ม To-do แล้ว')");
  assert.equal(calls, 1);
  assert.equal(h.element('#todoForm').controls[0].disabled, true);
  release();
  await first;
  assert.equal(resets, 1);
  assert.match(h.element('#toast').textContent, /เพิ่ม To-do แล้ว.*โหลดรายการล่าสุดไม่ได้/);
  assert.equal(h.element('#todoForm').controls[0].disabled, false);
});

test('failed save preserves entered data and permits retry without inventing success', async () => {
  const h = uiHarness();
  h.run("state.token='TEST_TOKEN';setAuthenticated(true)");
  h.context.save = async () => { throw new Error('TEST_FAILED'); };
  h.context.reset = () => { throw new Error('Must not reset'); };
  await h.run("saveForm($('#todoForm'),save,reset,'saved')");
  assert.equal(h.element('#toast').textContent, 'TEST_FAILED');
  assert.equal(h.element('#todoForm').controls[0].disabled, false);
  assert.equal(h.run("thaiDate('invalid')"), '-');
});
