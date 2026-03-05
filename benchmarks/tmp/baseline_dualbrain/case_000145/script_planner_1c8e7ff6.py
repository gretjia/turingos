with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr_part = tape.split('Expression: ')[1].strip()
    parts = expr_part.split()
    a = int(parts[0])
    op = parts[1]
    b = int(parts[2])
    result = a + b if op == '+' else a - b if op == '-' else a * b if op == '*' else a // b if op == '/' else 0
    print(result)