with open('MAIN_TAPE.md', 'r') as f: tape = f.read()
expr = tape.split('Expression: ')[1].strip()
parts = expr.split()
a, op, b = int(parts[0]), parts[1], int(parts[2])
result = a + b if op == '+' else a - b if op == '-' else a * b if op == '*' else a // b if op == '/' else 0
print(result)