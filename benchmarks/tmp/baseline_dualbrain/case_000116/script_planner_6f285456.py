with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr = tape.split('Expression: ')[1].split('\n')[0].strip()
    parts = expr.split()
    a, b = int(parts[0]), int(parts[2])
    print(a + b)