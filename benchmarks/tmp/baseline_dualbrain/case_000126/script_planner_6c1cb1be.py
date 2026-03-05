with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
expr = tape.split('Expression: ')[1].strip()
parts = expr.split()
a = int(parts[0])
op = parts[1]
b = int(parts[2])
if op == '+':
    result = a + b
elif op == '-':
    result = a - b
elif op == '*':
    result = a * b
elif op == '/':
    result = a // b
else:
    result = 0
print(result)