with open('MAIN_TAPE.md', 'r') as f: tape = f.read()
expr_line = [l for l in tape.split('\n') if 'Expression:' in l][0]
parts = expr_line.split('Expression: ')[1].strip().split()
a, op, b = int(parts[0]), parts[1], int(parts[2])
result = a + b if op == '+' else a - b if op == '-' else a * b if op == '*' else a // b
print(result)