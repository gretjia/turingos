with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr = tape.split('Expression: ')[1].split()
    a = int(expr[0])
    b = int(expr[2])
    print(a + b)