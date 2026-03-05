with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr = tape.split('Expression: ')[1].strip()
    parts = expr.split()
    result = int(parts[0]) + int(parts[2])
    print(result)