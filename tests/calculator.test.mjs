import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate } from '../src/apps/calculator.ts';

test('calculator handles precedence, parentheses, unary signs, and display operators', () => {
  const expressions = [
    ['2 + 3 × 4', 14], ['(2 + 3) × 4', 20], ['12 ÷ 3 − 2', 2],
    ['-(-3 + 1) * +5', 10], ['.25 + 1.5', 1.75], ['1e3 / 2e+1', 50],
    ['8 / 2 / 2', 2], ['10 - 3 - 2', 5], ['0.1 + 0.2', 0.3],
  ];
  for (const [expression, expected] of expressions) assert.equal(calculate(expression), expected, expression);
});

test('calculator rejects malformed input and zero division with useful errors', () => {
  assert.throws(() => calculate('1 / 0'), /divide by zero/i);
  assert.throws(() => calculate('1 / (2 - 2)'), /divide by zero/i);
  assert.throws(() => calculate('(1 + 2'), /parentheses/i);
  for (const expression of ['', '1 +', '1 2 3 +', '2(3)', '2**3', '2..4', '5%', '1 + 2)', 'NaN', 'Infinity']) {
    assert.throws(() => calculate(expression), Error, expression);
  }
});

test('calculator prevents JavaScript execution and refuses unbounded input or results', () => {
  delete globalThis.__depthCalculatorExecuted;
  for (const expression of [
    'globalThis.__depthCalculatorExecuted = true',
    '(()=>{globalThis.__depthCalculatorExecuted=true;return 1})()',
    'Math.random()', '1;process.exit()', '1["constructor"]',
  ]) assert.throws(() => calculate(expression), Error, expression);
  assert.equal(globalThis.__depthCalculatorExecuted, undefined);
  assert.throws(() => calculate('1'.repeat(501)), /shorter/i);
  assert.throws(() => calculate('1e999'), /too large/i);
  assert.throws(() => calculate('1e300 * 1e300'), /too large/i);
});
