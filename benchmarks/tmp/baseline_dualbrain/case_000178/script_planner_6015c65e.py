with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
# Extract expression after 'Expression: '
expr_part = tape.split('Expression: ')[1].strip()
# Get the numbers
parts = expr_part.split()
a, op, b = parts[0], parts[1], parts[2]
result = int(a) + int(b)
print(result)