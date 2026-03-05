with open('MAIN_TAPE.md', 'r') as f:
    tape = f.read()
    # Extract expression after 'Expression: '
    expr_part = tape.split('Expression: ')[1].strip()
    # Parse the expression (format: NUM1 + NUM2)
    parts = expr_part.split()
    num1 = int(parts[0])
    num2 = int(parts[2])
    result = num1 + num2
    print(result)