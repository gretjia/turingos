# 1M Test Pass 65 Failure & Python Exec Sandbox Fix (2026-03-06)

## Overview
During the 1M baseline test (Qwen 3.5 27B + 4x 9B Workers), the run failed at **case 251** (after 65 consecutive passes) with a `got=null` error due to an `invalid_vote_format` drop across all workers.

## Root Cause
1. The 9B Worker models correctly adhered to the Zero-Touch Data Extraction mandate, generating perfectly valid Python execution commands wrapped in bash invocation syntax:
   ```python
   python3 -c "with open('MAIN_TAPE.md', 'r') as f: tape = f.read(); expr = tape.split('Expression: ')[1].split(); print(int(expr[0]) + int(expr[2]))"
   ```
2. However, the TuringOS execution engine (`src/kernel/scheduler.ts`) contained a flaw in its `SYS_EXEC_PYTHON` processing. The scheduler allowed commands starting with `python` to pass validation, but then it wrote the **literal string** `python3 -c "..."` directly into a temporary file (`script_xxx.py`) and executed it via `python3 script_xxx.py`. 
3. This resulted in a native Python `SyntaxError` since `python3 -c "..."` is bash syntax, not valid Python code.
4. Consequently, the workers' actual output was swallowed and replaced with a `[PYTHON_EXEC_ERROR]` trace. When the Planner's MAP_REDUCE join phase attempted to extract the vote tokens, it failed, leading to a complete consensus collapse.

## Fix Implemented
- Updated `src/kernel/scheduler.ts` to recognize when workers generate `python3 -c` wrappers.
- Implemented a regex extraction phase (`/^python3?\s+-c\s+(['"])(.*)\1$/s`) to cleanly peel away the bash wrapper and extract only the inner Python code.
- This inner code is then written to the sandbox `.py` file and executed normally.
- Case 251 was manually re-tested and successfully read the correct answer `12168`. The 1M test can now safely resume.

## Commit
- `fix(hypercore): correctly parse python3 -c commands to prevent SyntaxError in execution sandbox`