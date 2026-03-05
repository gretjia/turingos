with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
# Extract expression after 'Expression: '
expr_part = tape.split('Expression: ')[1].strip()
# Parse two numbers and operator
parts = expr_part.split()
a, op, b = int(parts[0]), parts[1], int(parts[2])
# Calculate result
if op == '+':
    result = a + b
elif op == '-':
    result = a - b
elif op == '*':
    result = a * b
elif op == '/':
    result = a // b
else:
    result = eval(f"{a} {op} {b}")
print(result)