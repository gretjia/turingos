with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    expr = tape.split('Expression: ')[1].split()
    print(int(expr[0]) + int(expr[2]))