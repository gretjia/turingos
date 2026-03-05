with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr_part = tape.split('Expression: ')[1].strip()
    parts = expr_part.split()
    a = int(parts[0])
    b = int(parts[2])
    result = a + b
    print(result)