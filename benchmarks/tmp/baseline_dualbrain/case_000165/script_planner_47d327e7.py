with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
# Extract expression after 'Expression: '
expr_line = tape.split('Expression: ')[1].strip()
# Split into parts: number, operator, number
parts = expr_line.split()
a, op, b = parts[0], parts[1], parts[2]
print(f"{a} {op} {b}")