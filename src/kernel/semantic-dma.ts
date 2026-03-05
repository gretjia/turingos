export function verifyProofCarryingDMA(
  witness: any,
  fileContent: string
): { ok: boolean; result?: any; error?: string } {
  if (!witness || typeof witness !== 'object') {
    return { ok: false, error: 'Witness must be an object' };
  }

  const exact_extracts = witness.exact_extracts;
  if (!Array.isArray(exact_extracts)) {
    return { ok: false, error: 'exact_extracts must be an array of strings' };
  }

  for (const extract of exact_extracts) {
    if (typeof extract !== 'string') {
      return { ok: false, error: 'exact_extracts items must be strings' };
    }
    if (!fileContent.includes(extract)) {
      return { ok: false, error: `Exact extract not found literally in file: ${extract}` };
    }
  }

  const rpn_program = witness.rpn_program;
  if (typeof rpn_program !== 'string') {
    return { ok: false, error: 'rpn_program must be a string' };
  }

  const tokens = rpn_program.trim().split(/\s+/).filter((t) => t.length > 0);
  const stack: number[] = [];

  for (const token of tokens) {
    if (token === 'ADD' || token === 'SUB' || token === 'MUL' || token === 'DIV') {
      if (stack.length < 2) {
        return { ok: false, error: `Not enough operands for ${token}` };
      }
      const b = stack.pop()!;
      const a = stack.pop()!;
      if (token === 'ADD') stack.push(a + b);
      else if (token === 'SUB') stack.push(a - b);
      else if (token === 'MUL') stack.push(a * b);
      else if (token === 'DIV') {
        if (b === 0) return { ok: false, error: 'Division by zero' };
        stack.push(a / b);
      }
    } else {
      const num = Number(token);
      if (Number.isNaN(num)) {
        return { ok: false, error: `Invalid token: ${token}` };
      }
      stack.push(num);
    }
  }

  if (stack.length === 0) {
    return { ok: false, error: 'Empty stack after execution' };
  }

  return { ok: true, result: stack[stack.length - 1] };
}
