with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
# Extract the expression after 'Expression: '
expr_part = tape.split('Expression: ')[1].strip()
# Parse the expression (format: N + M)
parts = expr_part.split()
a, op, b = int(parts[0]), parts[1], int(parts[2])
result = a + b if op == '+' else a - b if op == '-' else a * b if op == '*' else a // b
print(result)