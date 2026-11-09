import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  decryptPayload,
  encryptPayload,
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderClashSubscription,
  renderRawSubscription,
  renderSurgeSubscription,
} from '../src/core.js';

const vmess = 'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vLXdzLXRscyIsCiAgImFkZCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAicG9ydCI6ICI0NDMiLAogICJpZCI6ICIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLAogICJzY3kiOiAiYXV0byIsCiAgIm5ldCI6ICJ3cyIsCiAgInRscyI6ICJ0bHMiLAogICJwYXRoIjogIi93cyIsCiAgImhvc3QiOiAiZWRnZS5leGFtcGxlLmNvbSIsCiAgInNuaSI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAiZnAiOiAiY2hyb21lIiwKICAiYWxwbiI6ICJoMixodHRwLzEuMSIKfQ==';

const { nodes } = parseNodeLinks(vmess);
assert.equal(nodes.length, 1);
assert.equal(nodes[0].type, 'vmess');
assert.equal(nodes[0].server, 'edge.example.com');

const { endpoints } = parsePreferredEndpoints('104.16.1.2#HK\n104.17.2.3:2053#US');
assert.equal(endpoints.length, 2);

const expanded = expandNodes(nodes, endpoints, { keepOriginalHost: true, namePrefix: 'CF' });
assert.equal(expanded.nodes.length, 2);
assert.equal(expanded.nodes[0].server, '104.16.1.2');
assert.equal(expanded.nodes[0].hostHeader, 'edge.example.com');
assert.equal(expanded.nodes[1].port, 2053);

const raw = renderRawSubscription(expanded.nodes);
assert.ok(raw.length > 10);

const clash = renderClashSubscription(expanded.nodes);
assert.match(clash, /proxies:/);
assert.match(clash, /edge\.example\.com/);

const surge = renderSurgeSubscription(expanded.nodes, 'https://sub.example.com/sub/demo?target=surge');
assert.match(surge, /\[Proxy]/);
assert.match(surge, /vmess/);

const secret = 'this-is-a-very-secret-key';
const token = await encryptPayload({ nodes: expanded.nodes }, secret);
const payload = await decryptPayload(token, secret);
assert.equal(payload.nodes.length, 2);

const clashResponse = await worker.fetch(
  new Request('https://sub.example.com/sub/existing?target=clash'),
  {
    SUB_STORE: {
      async get(key) {
        assert.equal(key, 'sub:existing');
        return JSON.stringify({ nodes: [{ ...expanded.nodes[0], host: 'edge.example.com' }] });
      },
    },
  },
);
assert.equal(clashResponse.status, 200);
assert.match(clashResponse.headers.get('content-type'), /^text\/yaml\b/);
const clashOutput = await clashResponse.text();
assert.match(clashOutput, /  - name: "节点选择"/);
assert.deepEqual(clashOutput.split('\nrules:\n')[1]?.trimEnd().split('\n').map(line => line.slice(4)), [
  'GEOSITE,private,DIRECT',
  'GEOIP,lan,DIRECT,no-resolve',
  'GEOSITE,openai,节点选择',
  'GEOSITE,github,节点选择',
  'GEOSITE,google,节点选择',
  'GEOSITE,youtube,节点选择',
  'GEOSITE,telegram,节点选择',
  'GEOIP,telegram,节点选择,no-resolve',
  'GEOSITE,cn,DIRECT',
  'GEOSITE,geolocation-!cn,节点选择',
  'GEOIP,CN,DIRECT',
  'MATCH,节点选择',
]);

console.log('smoke test passed');
