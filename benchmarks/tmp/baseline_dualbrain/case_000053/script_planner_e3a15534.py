with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr = tape.split('Expression: ')[1].strip()
    parts = expr.split()
    a = int(parts[0])
    b = int(parts[2])
    print(a + b)