/** A small arithmetic parser. It deliberately has no JavaScript evaluation path. */
export function calculate(expression: string): number {
  const input = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s/g, '');
  if (!input || input.length > 500) throw new Error('Enter a shorter calculation.');
  let position = 0;

  function primary(): number {
    if (input[position] === '+') { position++; return primary(); }
    if (input[position] === '-') { position++; return -primary(); }
    if (input[position] === '(') {
      position++;
      const result = sum();
      if (input[position++] !== ')') throw new Error('Close your parentheses.');
      return result;
    }
    const match = input.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) throw new Error('Check your calculation.');
    position += match[0].length;
    return Number(match[0]);
  }

  function product(): number {
    let result = primary();
    while (input[position] === '*' || input[position] === '/') {
      const operation = input[position++];
      const right = primary();
      if (operation === '/' && right === 0) throw new Error('Cannot divide by zero.');
      result = operation === '*' ? result * right : result / right;
    }
    return result;
  }

  function sum(): number {
    let result = product();
    while (input[position] === '+' || input[position] === '-') {
      const operation = input[position++];
      const right = product();
      result = operation === '+' ? result + right : result - right;
    }
    return result;
  }

  const result = sum();
  if (position !== input.length) throw new Error('Check your calculation.');
  if (!Number.isFinite(result)) throw new Error('That result is too large.');
  return Number(result.toPrecision(12));
}
