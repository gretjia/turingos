with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    # Extract expression after 'Expression: '
    expr_part = tape.split('Expression: ')[1].strip()
    # Split to get numbers and operator
    parts = expr_part.split()
    a = int(parts[0])
    b = int(parts[2])
    result = a + b
    print(result)