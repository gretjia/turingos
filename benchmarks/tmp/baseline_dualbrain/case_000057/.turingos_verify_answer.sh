#!/usr/bin/env bash
set -euo pipefail
if [ ! -f ANSWER.txt ]; then echo MISSING_ANSWER_FILE; exit 1; fi
val=$(tr -d '\r\n\t ' < ANSWER.txt)
if [[ ! "$val" =~ ^-?[0-9]+$ ]]; then echo INVALID_ANSWER_FORMAT:$val; exit 1; fi
if [ "$val" != '7336' ]; then echo MISMATCH_EXPECTED_7336_GOT_$val; exit 1; fi
