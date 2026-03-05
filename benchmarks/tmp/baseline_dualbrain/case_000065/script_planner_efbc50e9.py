with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr = tape.split('Expression: ')[1].split()
    a, b = int(expr[0]), int(expr[2])
    print(a + b)