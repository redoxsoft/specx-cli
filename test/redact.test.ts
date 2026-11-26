import assert from 'node:assert/strict';
import test from 'node:test';
import { redact } from '../src/core/redact.js';

test('redact: hides headers and http_headers objects', () => {
  const input = {
    headers: {
      'Custom-Header': 'foo',
      Accept: 'application/json',
    },
    http_headers: {
      Authorization: 'Bearer token123',
    },
    regularField: 'visible',
  };

  const output = redact(input) as Record<string, unknown>;
  assert.equal(output.headers, '<redacted>');
  assert.equal(output.http_headers, '<redacted>');
  assert.equal(output.regularField, 'visible');
});

test('redact: hides secret keys (Authorization, token, apiKey, API_KEY, password, secret)', () => {
  const input = {
    Authorization: 'Bearer SECRET-TOKEN-123',
    token: 'tok-abc-456',
    apiKey: 'key-xyz-789',
    API_KEY: 'sk-SECRET-456',
    api_key: 'sk-SECRET-789',
    'api-key': 'sk-SECRET-012',
    password: 'supersecretpassword',
    secret: 'mysecret',
    unrelated: 'safe-value',
    numericKey: 12345,
  };

  const output = redact(input) as Record<string, unknown>;
  assert.equal(output.Authorization, '<redacted>');
  assert.equal(output.token, '<redacted>');
  assert.equal(output.apiKey, '<redacted>');
  assert.equal(output.API_KEY, '<redacted>');
  assert.equal(output.api_key, '<redacted>');
  assert.equal(output['api-key'], '<redacted>');
  assert.equal(output.password, '<redacted>');
  assert.equal(output.secret, '<redacted>');
  assert.equal(output.unrelated, 'safe-value');
  assert.equal(output.numericKey, 12345);
});

test('redact: does not mutate its input', () => {
  const input = {
    headers: { Authorization: 'Bearer secret' },
    auth: {
      token: 'secret-token',
      apiKey: 'secret-key',
    },
    list: [{ password: 'secret-password' }],
  };

  const snapshot = JSON.parse(JSON.stringify(input));
  const output = redact(input);

  // Input must remain strictly unchanged
  assert.deepEqual(input, snapshot);

  // Output must have redacted values
  const redacted = output as {
    headers: string;
    auth: { token: string; apiKey: string };
    list: { password: string }[];
  };
  assert.equal(redacted.headers, '<redacted>');
  assert.equal(redacted.auth.token, '<redacted>');
  assert.equal(redacted.auth.apiKey, '<redacted>');
  assert.equal(redacted.list[0]?.password, '<redacted>');
});

test('redact: handles arrays, nested objects, and primitives', () => {
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.equal(redact('plain string'), 'plain string');
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);

  const arr = [
    { token: 'secret1' },
    'just-a-string',
    [{ apiKey: 'secret2' }],
  ];
  const redactedArr = redact(arr) as unknown[];
  assert.equal(Array.isArray(redactedArr), true);
  assert.equal((redactedArr[0] as Record<string, unknown>).token, '<redacted>');
  assert.equal(redactedArr[1], 'just-a-string');
  const innerArr = redactedArr[2] as unknown[];
  assert.equal((innerArr[0] as Record<string, unknown>).apiKey, '<redacted>');
});
