with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
# Extract expression after 'Expression: '
expr_part = tape.split('Expression: ')[1].strip()
# Parse the expression (format: N + M)
parts = expr_part.split()
a = int(parts[0])
op = parts[1]
b = int(parts[2])
result = a + b
print(result)