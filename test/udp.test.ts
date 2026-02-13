import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCF4Response } from '../src/udp.js';

describe('parseCF4Response', () => {
  it('parses valid CF4 response with 6 fields', () => {
    const raw = '["CF4","4","DEVICE123","My Stove","192.168.1.9","OK"]';
    const result = parseCF4Response(raw);
    assert.ok(result);
    assert.equal(result.id, 'DEVICE123');
    assert.equal(result.name, 'My Stove');
    assert.equal(result.ip, '192.168.1.9');
  });

  it('parses CF4 response with 5 fields (no OK)', () => {
    const raw = '["CF4","1","ABC","Stove Name","10.0.0.5"]';
    const result = parseCF4Response(raw);
    assert.ok(result);
    assert.equal(result.id, 'ABC');
    assert.equal(result.name, 'Stove Name');
    assert.equal(result.ip, '10.0.0.5');
  });

  it('returns null for non-CF4 response', () => {
    assert.equal(parseCF4Response('["2WL","0"]'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseCF4Response(''), null);
  });

  it('returns null for too few fields', () => {
    const raw = '["CF4","1","only_id","name"]';
    assert.equal(parseCF4Response(raw), null);
  });

  it('handles whitespace', () => {
    const raw = '  ["CF4","2","ID","Name","192.168.1.1","OK"]  ';
    const result = parseCF4Response(raw);
    assert.ok(result);
    assert.equal(result.ip, '192.168.1.1');
  });

  it('returns null for malformed JSON-like string', () => {
    assert.equal(parseCF4Response('not json at all'), null);
  });
});
