// HomeBell-specific contract rules that generic OpenAPI linters cannot express.
// Run: pnpm --filter @homebell/contracts test   (requires `generate` to have run)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = yaml.load(readFileSync(join(root, 'bundled/openapi.v1.yaml'), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const resolveParam = (p) => (p.$ref ? spec.components.parameters[p.$ref.split('/').pop()] : p);

function* operations() {
  for (const [path, item] of Object.entries(spec.paths)) {
    const shared = (item.parameters ?? []).map(resolveParam);
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = [...shared, ...(op.parameters ?? []).map(resolveParam)];
      yield { path, method, op, params };
    }
  }
}
const hasParam = (params, name, location) =>
  params.some((p) => p.name === name && p.in === location);

test('every path is versioned under /v1', () => {
  for (const path of Object.keys(spec.paths)) assert.match(path, /^\/v1\//, path);
});

test('tenant-plane operations declare the tenantId path parameter', () => {
  for (const { path, method, params } of operations()) {
    if (!path.startsWith('/v1/t/')) continue;
    assert.ok(path.startsWith('/v1/t/{tenantId}/'), `${path} must start with /v1/t/{tenantId}/`);
    assert.ok(
      hasParam(params, 'tenantId', 'path'),
      `${method.toUpperCase()} ${path} lacks tenantId`,
    );
  }
});

test('guardian self-service and invitation operations require X-Device-Id', () => {
  for (const { path, method, params } of operations()) {
    if (!path.startsWith('/v1/me/') && !path.startsWith('/v1/invitations/')) continue;
    assert.ok(
      params.some((p) => p.name === 'X-Device-Id' && p.in === 'header' && p.required),
      `${method.toUpperCase()} ${path} must require X-Device-Id`,
    );
  }
});

test('guardian operations document 400 (DEVICE_ID_REQUIRED) and 403 (scope / guardian state)', () => {
  for (const { path, method, op } of operations()) {
    if (!path.startsWith('/v1/me/')) continue;
    for (const status of ['400', '403']) {
      assert.ok(op.responses[status], `${method.toUpperCase()} ${path} must document ${status}`);
    }
  }
});

test('retry-prone writes require Idempotency-Key', () => {
  const mustBeIdempotent = [
    'createPickupRequest',
    'acknowledgePickup',
    'markSentOut',
    'markSentOutBulk',
    'completePurchase',
    'createPurchaseIntent',
    'createGuardianInvitation',
    'platformCreateTenant',
    'platformTransitionTenant',
    'commitImport',
    'deviceTransfer',
    'redeemInvitation',
    'grantLicenseSeats',
  ];
  const found = new Map();
  for (const { op, params } of operations()) found.set(op.operationId, params);
  for (const id of mustBeIdempotent) {
    assert.ok(found.has(id), `operation ${id} missing`);
    assert.ok(
      found.get(id).some((p) => p.name === 'Idempotency-Key' && p.in === 'header' && p.required),
      `${id} must require Idempotency-Key`,
    );
  }
});

test('error responses use application/problem+json', () => {
  const responses = spec.components.responses ?? {};
  for (const { path, method, op } of operations()) {
    for (const [status, resp] of Object.entries(op.responses)) {
      if (Number(status) < 400) continue;
      const r = resp.$ref ? responses[resp.$ref.split('/').pop()] : resp;
      assert.ok(
        r.content?.['application/problem+json'],
        `${method.toUpperCase()} ${path} ${status} must be application/problem+json`,
      );
    }
  }
});

test('display endpoints never expose guardian PII', () => {
  const forbidden = ['phone', 'maskedPhone', 'guardian', 'guardianName', 'note', 'lastName'];
  for (const name of ['DisplayItem', 'DisplayFeed', 'DisplayEvent']) {
    const props = Object.keys(spec.components.schemas[name].properties ?? {});
    for (const f of forbidden) assert.ok(!props.includes(f), `${name} must not include ${f}`);
  }
});

test('all state enums required by the product are present', () => {
  const required = [
    'TenantLifecycleState',
    'PickupRequestState',
    'GuardianState',
    'InvitationState',
    'DeviceState',
    'LicenseValidityMode',
    'LicenseSeatState',
  ];
  for (const name of required)
    assert.ok(spec.components.schemas[name]?.enum, `${name} enum missing`);
  assert.deepEqual([...spec.components.schemas.TenantLifecycleState.enum].sort(), [
    'active_paid',
    'cancelled',
    'deactivated',
    'draft',
    'expired',
    'manual_override',
    'offboarding',
    'pilot_free',
    'suspended',
    'trial',
  ]);
});
