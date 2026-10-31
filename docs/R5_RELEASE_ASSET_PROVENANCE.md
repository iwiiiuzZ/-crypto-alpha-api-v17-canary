# R5 release-package asset provenance and integrity gates

This is a packaging checklist, not a release approval. The CI-generated R5 candidate ZIP contains tested Worker code, tests, locked dependencies and operations files, **not** the user's original complete GPT knowledge and instructions. Do not distribute that candidate ZIP as a full GPT installation.

The final assembled release must additionally contain the original files from `Crypto_Alpha_V27_6_2_BackendFix(1).zip` under their original paths. Verify exact SHA-256 before copying:

| Original path | SHA-256 |
|---|---|
| `02_INSTRUCTIONS/CRYPTO_ALPHA_V27_INSTRUCTIONS.txt` | `d1142d19864d75d4` (prefix) |
| `02_INSTRUCTIONS/CONVERSATION_STARTERS.txt` | `bf602fe07cb31ed0` (prefix) |
| `02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt` | `f357b0e9d779c316` (prefix) |
| `03_KNOWLEDGE/CRYPTO_ALPHA_V27_KNOWLEDGE_FULL.md` | `cc797964732217ae` (prefix) |
| `06_ACTION/openapi.json` | `cf0aa97a5a8a25ba` (prefix) |

Also include four operation IDs, sub-500-character opening prompt, release manifest, a read-only acceptance script, exact production source/deployment identity, rollback instructions and a limitations report. Never imply that unit tests prove production data feeds, notification delivery, installed GPT configuration, or strategy profitability.

Use `ops/assemble-delivery.py` with the privately held original ZIP and an output directory outside this public repository. It verifies full original SHA-256 values, the source Git blob, all regression suites including native runtime tests, the four original starters, the 403-character opening and the exact generated four-operation API. It preserves the original ZIP for rollback. Only the obsolete build identifier in the full opening changes; core instructions and course knowledge remain byte-identical. Assembly alone is explicitly `ASSEMBLED_NOT_FINAL`.

R5 deployment requires a separate source-locked release-intent commit; final production acceptance is performed after that controlled deployment. Do not modify production while merely generating a candidate package. The previous wording incorrectly required postdeployment evidence before deployment itself.
