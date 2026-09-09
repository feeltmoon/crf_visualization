const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server.cjs');
test('runtime assets, methods, and private-file exclusion', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const file of ['/', '/index.html', '/styles.css', '/app.js', '/uploader.js', '/study-data.js', '/rules-data.js', '/rules.yaml', '/vendor/xlsx.full.min.js', '/assets/fonts/poppins-400.ttf', '/assets/fonts/poppins-500.ttf', '/assets/fonts/poppins-600.ttf', '/assets/fonts/poppins-700.ttf']) {
      const response = await fetch(base + file); assert.equal(response.status, 200, file); await response.arrayBuffer();
    }
    for (const file of ['/server.cjs', '/package.json', '/.git/config', '/sample_als.xlsx', '/theme-lab.html', '/%2e%2e%2fserver.cjs', '/assets/']) assert.equal((await fetch(base + file)).status, 404, file);
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.match(head.headers.get('content-type'), /text\/html/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
